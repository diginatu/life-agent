import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { NotifierAdapter } from "../adapters/notifier.ts";
import type { CaptureResult } from "../schemas/capture.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { PolicyDecision } from "../schemas/policy.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { DraftMessage } from "../schemas/message.ts";

interface PersistNodeDeps {
  fs: FilesystemAdapter;
  notifier: NotifierAdapter;
  config: { logDir: string };
}

interface PersistNodeState {
  capture?: CaptureResult;
  summary?: SceneSummary;
  policy?: PolicyDecision;
  decision?: ActionSelection;
  message?: DraftMessage | null;
  errors?: string[];
}

interface PersistNodeResult {
  errors?: string[];
}

const NUDGE_ACTIONS = new Set(["nudge_break", "nudge_sleep"]);

export function createPersistNode(deps: PersistNodeDeps) {
  const { fs, notifier, config } = deps;

  return async (state: PersistNodeState): Promise<PersistNodeResult> => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    const logEntry = {
      eventId: crypto.randomUUID(),
      timestamp: now.toISOString(),
      capture: state.capture ?? null,
      summary: state.summary ?? null,
      policy: state.policy ?? null,
      decision: state.decision ?? null,
      message: state.message ?? null,
      errors: state.errors ?? [],
      tags: [] as string[],
    };

    // Write to JSONL
    try {
      await fs.appendJsonLine(config.logDir, dateStr, logEntry);
    } catch (err) {
      const msg = `persist: fs write error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    // Send desktop notification for nudge actions with a message
    if (state.decision && NUDGE_ACTIONS.has(state.decision.action) && state.message) {
      try {
        await notifier.notify(state.message.title, state.message.body);
      } catch (err) {
        const msg = `persist: notify error: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
        // Don't fail the whole node for notification failure
      }
    }

    // Print one-line summary
    const action = state.decision?.action ?? "unknown";
    const messageTitle = state.message?.title ? ` "${state.message.title}"` : "";
    console.log(`[${now.toISOString()}] action=${action}${messageTitle}`);

    return {};
  };
}
