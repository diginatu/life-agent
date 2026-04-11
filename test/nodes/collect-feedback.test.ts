import { test, expect, describe } from "bun:test";
import { createCollectFeedbackNode } from "../../src/nodes/collect-feedback.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import type { DiscordAdapter } from "../../src/adapters/discord.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

function mockFs(entries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => entries,
  };
}

function mockDiscord(
  replies: Array<{ text: string; userId: string; timestamp: string }> = [],
): DiscordAdapter {
  return {
    sendMessage: async () => "msg-id",
    sendEmbed: async () => "msg-id",
    collectReplies: async () => replies,
    getLatestMessageId: async () => "latest",
    destroy: async () => {},
  };
}

describe("collect-feedback node", () => {
  test("returns empty update when no discord adapter", async () => {
    const node = createCollectFeedbackNode({
      fs: mockFs(),
      logDir: "./logs",
      actionsConfig,
    });

    const result = await node();

    expect(result.userFeedback).toBeUndefined();
  });

  test("returns empty update when no prior log entry", async () => {
    const node = createCollectFeedbackNode({
      fs: mockFs([]),
      logDir: "./logs",
      actionsConfig,
      discord: mockDiscord([
        { text: "hello", userId: "u1", timestamp: "2026-04-11T10:00:00.000Z" },
      ]),
    });

    const result = await node();

    expect(result.userFeedback).toBeUndefined();
  });

  test("returns replies when prior entry has discordMessageId", async () => {
    const entries = [{ discordMessageId: "prev-msg-id" }];
    const replies = [
      { text: "ok got it", userId: "u1", timestamp: "2026-04-11T10:05:00.000Z" },
    ];
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig,
      discord: mockDiscord(replies),
    });

    const result = await node();

    expect(result.userFeedback).toEqual(replies);
  });

  test("falls back to discordLastSeenMessageId when no discordMessageId", async () => {
    const entries = [{ discordLastSeenMessageId: "seen-id" }];
    const replies = [
      { text: "passive reply", userId: "u2", timestamp: "2026-04-11T10:06:00.000Z" },
    ];
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig,
      discord: mockDiscord(replies),
    });

    const result = await node();

    expect(result.userFeedback).toEqual(replies);
  });

  test("returns undefined when no replies found", async () => {
    const entries = [{ discordMessageId: "prev-msg-id" }];
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig,
      discord: mockDiscord([]),
    });

    const result = await node();

    expect(result.userFeedback).toBeUndefined();
  });

  test("passes discordMentionUserId to collectReplies", async () => {
    const entries = [{ discordMessageId: "prev-msg-id" }];
    const calls: Array<{ afterId: string; allowedUserId?: string }> = [];
    const discord: DiscordAdapter = {
      sendMessage: async () => "x",
      sendEmbed: async () => "x",
      collectReplies: async (afterId: string, allowedUserId?: string) => {
        calls.push({ afterId, allowedUserId });
        return [];
      },
      getLatestMessageId: async () => null,
      destroy: async () => {},
    };
    const cfg = mockActionsConfig({}, { discordMentionUserId: "user-xyz" });
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig: cfg,
      discord,
    });

    await node();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.afterId).toBe("prev-msg-id");
    expect(calls[0]!.allowedUserId).toBe("user-xyz");
  });

  test("handles collectReplies error gracefully", async () => {
    const entries = [{ discordMessageId: "prev-msg-id" }];
    const discord: DiscordAdapter = {
      sendMessage: async () => "x",
      sendEmbed: async () => "x",
      collectReplies: async () => {
        throw new Error("network down");
      },
      getLatestMessageId: async () => null,
      destroy: async () => {},
    };
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig,
      discord,
    });

    const result = await node();

    expect(result.userFeedback).toBeUndefined();
  });

  test("returns empty update when prior entry has no cursor", async () => {
    const entries = [{ eventId: "abc" }];
    const node = createCollectFeedbackNode({
      fs: mockFs(entries),
      logDir: "./logs",
      actionsConfig,
      discord: mockDiscord([
        { text: "should not fetch", userId: "u1", timestamp: "2026-04-11T10:00:00.000Z" },
      ]),
    });

    const result = await node();

    expect(result.userFeedback).toBeUndefined();
  });
});
