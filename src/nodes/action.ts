import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { BaseStore } from "@langchain/langgraph";
import { ActionSelectionSchema, type ActionSelection } from "../schemas/action.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { Config } from "../config.ts";
import { formatTime } from "./format-time.ts";
import {
  formatHistory,
  formatUserFeedback,
  type LogEntry,
  type UserFeedbackEntry,
} from "./history-format.ts";

interface ActionNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  store?: BaseStore;
  l2DelayHours?: number;
  now?: () => Date;
}

interface ActionNodeState {
  summary?: SceneSummary;
  userFeedback?: UserFeedbackEntry[];
}

interface ActionNodeResult {
  decision?: ActionSelection;
  errors?: string[];
}

interface LayerEntry {
  content: string;
  windowStart: string;
  windowEnd: string;
}

const FALLBACK_DECISION: ActionSelection = {
  action: "none",
  priority: "low",
  reason: "fallback: action selection failed",
};

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildPrompt(
  summary: SceneSummary,
  actionsConfig: Config,
  currentTime: Date,
  l3Entries: LayerEntry[],
  l2Entries: LayerEntry[],
  logEntries?: LogEntry[],
  userFeedback?: UserFeedbackEntry[],
): string {
  const allActions = actionsConfig.getActionNames();
  const actionDescriptions = allActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  let historySections = "";
  historySections += formatUserFeedback(userFeedback);

  if (l3Entries.length > 0) {
    historySections += "\n6-hour overview:\n";
    historySections += l3Entries.map((e) => `[${e.windowStart}..${e.windowEnd}] ${e.content}`).join("\n");
    historySections += "\n";
  }

  if (l2Entries.length > 0) {
    historySections += "\nHourly overview:\n";
    historySections += l2Entries.map((e) => `[${e.windowStart}] ${e.content}`).join("\n");
    historySections += "\n";
  }

  if (logEntries && logEntries.length > 0) {
    const { history } = formatHistory(logEntries);
    if (history) {
      historySections += `\nRecent history:\n${history}\n`;
    }
  }

  return `You are a personal assistant. Based on the scene analysis and history, select the most appropriate action.

Scene analysis:
- Person present: ${summary.personPresent}
- Posture: ${summary.posture}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Confidence: ${summary.confidence}

Current time:
- ${formatTime(currentTime)}
${historySections}
Available actions:
${actionDescriptions}
${!userFeedback || userFeedback.length === 0 ? "\nIMPORTANT: There are no new user messages in this cycle. Do NOT just \"reply\"" : "\nIMPORTANT: The user has sent a new message this cycle. You MUST choose an action that acknowledges their message. Do NOT choose \"none\" when the user is actively communicating with you."}
You MUST choose an action from the available actions list above. Return a JSON object with exactly these fields:
{
  "reason": string explaining your choice
  "priority": "low" | "medium" | "high",
  "action": one of ${JSON.stringify(allActions)},
}

Return ONLY the JSON object, no other text.`;
}

export function createActionNode(deps: ActionNodeDeps) {
  return async (state: ActionNodeState): Promise<ActionNodeResult> => {
    if (!state.summary) {
      return {
        decision: FALLBACK_DECISION,
        errors: ["action: no summary data in state"],
      };
    }

    const now = deps.now ?? (() => new Date());
    const currentTime = now();
    const l2DelayHours = deps.l2DelayHours ?? 1;

    // Read L3 entries
    const allL3Items = deps.store
      ? await deps.store.search(["memory", "L3"], { limit: 10000 })
      : [];
    const allL3 = allL3Items
      .map((item) => item.value as LayerEntry)
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart));

    const latestL3WindowEnd = allL3.reduce<string | null>((max, e) => {
      if (max === null) return e.windowEnd;
      return e.windowEnd > max ? e.windowEnd : max;
    }, null);

    // Read L2 entries, filtering by >= latestL3WindowEnd
    const allL2Items = deps.store
      ? await deps.store.search(["memory", "L2"], { limit: 10000 })
      : [];
    const filteredL2 = allL2Items
      .map((item) => item.value as LayerEntry)
      .filter((e) => latestL3WindowEnd === null || e.windowStart >= latestL3WindowEnd)
      .sort((a, b) => a.windowStart.localeCompare(b.windowStart));

    const latestL2WindowEnd = filteredL2.reduce<string | null>((max, e) => {
      if (max === null) return e.windowEnd;
      return e.windowEnd > max ? e.windowEnd : max;
    }, null);

    // Read L1 entries via readEntriesSince
    let logEntries: LogEntry[] | undefined;
    if (deps.fs && deps.logDir) {
      let cutoff: string;
      if (latestL2WindowEnd !== null) {
        cutoff = latestL2WindowEnd;
      } else {
        // No L2: use now - (1 + l2DelayHours) hours
        cutoff = new Date(currentTime.getTime() - (1 + l2DelayHours) * 3600000).toISOString();
      }
      try {
        logEntries = await deps.fs.readEntriesSince(deps.logDir, cutoff) as LogEntry[];
      } catch {
        // History is best-effort; continue without it
      }
    }

    const prompt = buildPrompt(
      state.summary,
      deps.actionsConfig,
      currentTime,
      allL3,
      filteredL2,
      logEntries,
      state.userFeedback,
    );

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `action: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    const jsonStr = extractJson(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const msg = `action: failed to parse JSON from ollama response: ${jsonStr.slice(0, 200)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    const result = ActionSelectionSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `action: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    return { decision: result.data };
  };
}
