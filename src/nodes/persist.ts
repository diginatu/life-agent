import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { NotifierAdapter } from "../adapters/notifier.ts";
import type { DiscordAdapter } from "../adapters/discord.ts";
import type { CaptureResult } from "../schemas/capture.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { PolicyDecision } from "../schemas/policy.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { DraftMessage } from "../schemas/message.ts";
import type { Config } from "../config.ts";

interface PersistNodeDeps {
  fs: FilesystemAdapter;
  notifier: NotifierAdapter;
  config: { logDir: string };
  actionsConfig: Config;
  discord?: DiscordAdapter;
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

export function createPersistNode(deps: PersistNodeDeps) {
  const { fs, notifier, config, actionsConfig, discord } = deps;

  return async (state: PersistNodeState): Promise<PersistNodeResult> => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    // Collect feedback from previous Discord message if applicable
    let feedbackFromPrevious: { text: string; userId: string; timestamp: string }[] | null = null;
    if (discord) {
      try {
        const lastEntries = await fs.readLastNLines(config.logDir, dateStr, 1);
        if (lastEntries.length > 0) {
          const prevEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;
          const prevMsgId = prevEntry.discordMessageId as string | undefined;
          if (prevMsgId) {
            const replies = await discord.collectReplies(prevMsgId);
            if (replies.length > 0) {
              feedbackFromPrevious = replies;
            }
          }
        }
      } catch (err) {
        console.error(`persist: discord feedback error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Send Discord message for active actions
    let discordMessageId: string | null = null;
    if (discord && state.decision && actionsConfig.isActiveAction(state.decision.action) && state.message) {
      try {
        discordMessageId = await discord.sendEmbed(state.message.title, state.message.body);
      } catch (err) {
        console.error(`persist: discord send error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const logEntry: Record<string, unknown> = {
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

    if (discordMessageId) {
      logEntry.discordMessageId = discordMessageId;
    }
    if (feedbackFromPrevious) {
      logEntry.feedbackFromPrevious = feedbackFromPrevious;
    }

    // Write to JSONL
    try {
      await fs.appendJsonLine(config.logDir, dateStr, logEntry);
    } catch (err) {
      const msg = `persist: fs write error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    // Send desktop notification for active actions with a message
    if (state.decision && actionsConfig.isActiveAction(state.decision.action) && state.message) {
      try {
        await notifier.notify(state.message.title, state.message.body);
      } catch (err) {
        const msg = `persist: notify error: ${err instanceof Error ? err.message : String(err)}`;
        console.error(msg);
      }
    }

    // Print one-line summary
    const action = state.decision?.action ?? "unknown";
    const messageTitle = state.message?.title ? ` "${state.message.title}"` : "";
    console.log(`[${now.toISOString()}] action=${action}${messageTitle}`);

    return {};
  };
}
