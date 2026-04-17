import type { DiscordAdapter } from "../adapters/discord.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { Config } from "../config.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { CaptureResult } from "../schemas/capture.ts";
import type { DraftMessage } from "../schemas/message.ts";
import type { SceneSummary } from "../schemas/summary.ts";

interface PersistNodeDeps {
  fs: FilesystemAdapter;
  config: { logDir: string };
  actionsConfig: Config;
  discord?: DiscordAdapter;
}

interface PersistNodeState {
  capture?: CaptureResult;
  summary?: SceneSummary;
  decision?: ActionSelection;
  message?: DraftMessage | null;
  userFeedback?: { text: string; userId: string; timestamp: string }[];
  errors?: string[];
}

interface PersistNodeResult {
  errors?: string[];
}

export function createPersistNode(deps: PersistNodeDeps) {
  const { fs, config, actionsConfig, discord } = deps;

  return async (state: PersistNodeState): Promise<PersistNodeResult> => {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    // Send Discord message for active actions
    let discordMessageId: string | null = null;
    if (
      discord &&
      state.decision &&
      actionsConfig.isActiveAction(state.decision.action) &&
      state.message
    ) {
      try {
        discordMessageId = await discord.sendMessage(
          state.message.body,
          actionsConfig.settings.discordMentionUserId || undefined,
        );
      } catch (err) {
        console.error(
          `persist: discord send error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Get latest message ID as cursor for next cycle when no embed was sent
    let discordLastSeenMessageId: string | null = null;
    if (discord && !discordMessageId) {
      try {
        discordLastSeenMessageId = await discord.getLatestMessageId();
      } catch (err) {
        console.error(
          `persist: discord getLatestMessageId error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const logEntry: Record<string, unknown> = {
      eventId: crypto.randomUUID(),
      timestamp: now.toISOString(),
      capture: state.capture ?? null,
      summary: state.summary ?? null,
      policy: null,
      decision: state.decision ?? null,
      message: state.message ?? null,
      errors: state.errors ?? [],
      tags: [] as string[],
    };

    if (discordMessageId) {
      logEntry.discordMessageId = discordMessageId;
    }
    if (discordLastSeenMessageId) {
      logEntry.discordLastSeenMessageId = discordLastSeenMessageId;
    }
    if (state.userFeedback && state.userFeedback.length > 0) {
      logEntry.feedbackFromPrevious = state.userFeedback;
    }

    // Write to JSONL
    try {
      await fs.appendJsonLine(config.logDir, dateStr, logEntry);
    } catch (err) {
      const msg = `persist: fs write error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { errors: [msg] };
    }

    // Print one-line summary
    const action = state.decision?.action ?? "unknown";
    const preview = state.message?.body
      ? ` "${state.message.body.slice(0, 60)}${state.message.body.length > 60 ? "…" : ""}"`
      : "";
    console.log(`[${now.toISOString()}] action=${action}${preview}`);

    return {};
  };
}
