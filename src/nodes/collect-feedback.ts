import type { DiscordAdapter } from "../adapters/discord.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { Config } from "../config.ts";

interface CollectFeedbackDeps {
  fs: FilesystemAdapter;
  logDir: string;
  actionsConfig: Config;
  discord?: DiscordAdapter;
  now?: () => Date;
}

interface CollectFeedbackResult {
  userFeedback?: Array<{ text: string; userId: string; timestamp: string }>;
}

export function createCollectFeedbackNode(deps: CollectFeedbackDeps) {
  const { fs, logDir, actionsConfig, discord } = deps;
  const now = deps.now ?? (() => new Date());

  return async (): Promise<CollectFeedbackResult> => {
    if (!discord) return {};

    try {
      const dateStr = now().toISOString().slice(0, 10);
      const lastEntries = await fs.readLastNLinesAcrossDays(logDir, dateStr, 1);
      if (lastEntries.length === 0) return {};

      const prevEntry = lastEntries[lastEntries.length - 1] as Record<string, unknown>;
      const prevMsgId = (prevEntry.discordMessageId ?? prevEntry.discordLastSeenMessageId) as
        | string
        | undefined;
      if (!prevMsgId) return {};

      const replies = await discord.collectReplies(
        prevMsgId,
        actionsConfig.settings.discordMentionUserId || undefined,
      );

      if (replies.length === 0) return {};

      console.log(`[User Feedback]\n${replies.length} replies collected`);
      return { userFeedback: replies };
    } catch (err) {
      console.error(`collect-feedback: error: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  };
}
