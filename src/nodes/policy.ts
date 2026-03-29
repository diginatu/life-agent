import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { PolicyDecision } from "../schemas/policy.ts";
import type { Action } from "../schemas/action.ts";
import type { SceneSummary } from "../schemas/summary.ts";

const ALL_ACTIONS: Action[] = ["none", "log_only", "nudge_break", "nudge_sleep"];
const PASSIVE_ACTIONS: Action[] = ["none", "log_only"];
const NONE_ONLY: Action[] = ["none"];

interface PolicyConfig {
  quietHoursStart: number;
  quietHoursEnd: number;
  cooldownMinutes: number;
  confidenceThreshold: number;
  logDir: string;
}

interface PolicyNodeDeps {
  fs: FilesystemAdapter;
  config: PolicyConfig;
  now?: () => Date;
}

interface PolicyNodeState {
  summary?: SceneSummary;
}

interface PolicyNodeResult {
  policy?: PolicyDecision;
  errors?: string[];
}

const ACTIVE_ACTIONS = new Set(["nudge_break", "nudge_sleep"]);

function isInQuietHours(hour: number, start: number, end: number): boolean {
  if (start > end) {
    return hour >= start || hour < end;
  }
  return hour >= start && hour < end;
}

export function createPolicyNode(deps: PolicyNodeDeps) {
  const { fs, config, now = () => new Date() } = deps;

  return async (state: PolicyNodeState): Promise<PolicyNodeResult> => {
    if (!state.summary) {
      return {
        policy: {
          availableActions: NONE_ONLY,
          cooldownBlocked: false,
          quietHoursBlocked: false,
          reasons: ["no summary data"],
        },
        errors: ["policy: no summary data in state"],
      };
    }

    const reasons: string[] = [];
    let restricted = false;
    const currentTime = now();
    const hour = currentTime.getHours();

    // Quiet hours check
    const quietHoursBlocked = isInQuietHours(
      hour,
      config.quietHoursStart,
      config.quietHoursEnd,
    );
    if (quietHoursBlocked) {
      restricted = true;
      reasons.push(`quiet hours active (${config.quietHoursStart}:00–${config.quietHoursEnd}:00)`);
    }

    // Read last entries for cooldown and duplicate checks
    const dateStr = currentTime.toISOString().slice(0, 10);
    let lastEntries: unknown[];
    try {
      lastEntries = await fs.readLastNLines(config.logDir, dateStr, 5);
    } catch {
      lastEntries = [];
    }

    // Cooldown check: only for active actions (nudge_break, nudge_sleep)
    let cooldownBlocked = false;
    if (lastEntries.length > 0) {
      const lastEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;
      const lastAction = (lastEntry.decision as Record<string, unknown>)?.action as string | undefined;
      const lastTimestamp = lastEntry.timestamp as string | undefined;

      if (lastAction && ACTIVE_ACTIONS.has(lastAction) && lastTimestamp) {
        const elapsed = currentTime.getTime() - new Date(lastTimestamp).getTime();
        const elapsedMinutes = elapsed / (1000 * 60);
        if (elapsedMinutes < config.cooldownMinutes) {
          cooldownBlocked = true;
          restricted = true;
          reasons.push(`cooldown active: last action "${lastAction}" was ${Math.round(elapsedMinutes)} min ago`);
        }
      }
    }

    // Confidence threshold check
    if (state.summary.confidence < config.confidenceThreshold) {
      restricted = true;
      reasons.push(`confidence ${state.summary.confidence} below threshold ${config.confidenceThreshold}`);
    }

    // Duplicate suppression: same scene + activity as last entry
    if (lastEntries.length > 0) {
      const lastEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;
      const lastSummary = lastEntry.summary as Record<string, unknown> | undefined;
      if (lastSummary) {
        const sameScene = lastSummary.scene === state.summary.scene;
        const sameActivity = lastSummary.activityGuess === state.summary.activityGuess;
        if (sameScene && sameActivity) {
          restricted = true;
          reasons.push("duplicate: same scene and activity as last entry");
        }
      }
    }

    return {
      policy: {
        availableActions: restricted ? PASSIVE_ACTIONS : ALL_ACTIONS,
        cooldownBlocked,
        quietHoursBlocked,
        reasons,
      },
    };
  };
}
