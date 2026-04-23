import { test, expect, describe } from "bun:test";
import { createPersistNode } from "../../src/nodes/persist.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import type { DiscordAdapter } from "../../src/adapters/discord.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

function mockFs(): FilesystemAdapter & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    appendJsonLine: async (_dir, _date, data) => { written.push(data); },
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => [],
    pruneEntriesBefore: async () => {},
  };
}

function mockDiscord(
  replies: Array<{ text: string; userId: string; timestamp: string }> = [],
  latestMessageId: string | null = "latest-channel-msg",
): DiscordAdapter & {
  messages: Array<{ body: string; mentionUserId?: string }>;
  embeds: Array<{ title: string; body: string }>;
} {
  let msgCounter = 0;
  const messages: Array<{ body: string; mentionUserId?: string }> = [];
  const embeds: Array<{ title: string; body: string }> = [];
  return {
    messages,
    embeds,
    sendMessage: async (body: string, mentionUserId?: string) => {
      messages.push({ body, mentionUserId });
      msgCounter++;
      return `discord-msg-${msgCounter}`;
    },
    sendEmbed: async (title: string, body: string) => {
      embeds.push({ title, body });
      msgCounter++;
      return `discord-msg-${msgCounter}`;
    },
    collectReplies: async () => replies,
    destroy: async () => {},
    getLatestMessageId: async () => latestMessageId,
  };
}

const baseState = {
  capture: {
    imagePath: "captures/test.jpg",
    timestamp: "2026-03-29T12:00:00.000Z",
    width: 640,
    height: 480,
  },
  summary: {
    personPresent: true,
    posture: "sitting",
    scene: "desk",
    activityGuess: "coding",
    confidence: 0.8,
  },
  policy: {
    availableActions: ["none", "nudge_break", "nudge_sleep"] as const,
    cooldownBlocked: false,
    reasons: [],
  },
  decision: {
    action: "none" as const,
    reason: "routine",
  },
  message: null,
  errors: [] as string[],
};

describe("persist node", () => {
  test("writes log entry to filesystem", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    await node(baseState);

    expect(fs.written.length).toBe(1);
    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.eventId).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.capture).toBeDefined();
    expect(entry.decision).toBeDefined();
  });

  test("includes errors in log entry", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    await node({ ...baseState, errors: ["some error"] });

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.errors).toEqual(["some error"]);
  });

  test("handles fs write error gracefully", async () => {
    const failingFs: FilesystemAdapter = {
      appendJsonLine: async () => { throw new Error("disk full"); },
      readLastNLines: async () => [],
      readLastNLinesAcrossDays: async () => [],
      readAllLinesForDay: async () => [],
      readEntriesSince: async () => [],
      pruneEntriesBefore: async () => {},
    };
    const node = createPersistNode({ fs: failingFs, config: { logDir: "./logs" }, actionsConfig });

    const result = await node(baseState);

    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("disk full");
  });

  test("still writes log even when no decision", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    const state = { ...baseState, decision: undefined };
    await node(state);

    expect(fs.written.length).toBe(1);
  });

  test("sends to Discord when adapter provided and action is active", async () => {
    const fs = mockFs();
    const discord = mockDiscord();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, reason: "long session" },
      message: { body: "Stand up and stretch — you've been sitting a while." },
    };
    await node(state);

    expect(discord.messages.length).toBe(1);
    expect(discord.messages[0]!.body).toBe("Stand up and stretch — you've been sitting a while.");

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.discordMessageId).toBe("discord-msg-1");
  });

  test("does not send to Discord for passive actions", async () => {
    const fs = mockFs();
    const discord = mockDiscord();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    await node(baseState);

    expect(discord.messages.length).toBe(0);
  });

  test("does not send to Discord when adapter not provided", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, reason: "long session" },
      message: { body: "Stretch." },
    };
    await node(state);
  });

  test("persists state.userFeedback into log entry as feedbackFromPrevious", async () => {
    const fs = mockFs();
    const discord = mockDiscord();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    const feedback = [
      { text: "ok thanks", userId: "user1", timestamp: "2026-04-11T10:05:00.000Z" },
    ];
    await node({ ...baseState, userFeedback: feedback });

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.feedbackFromPrevious).toEqual(feedback);
  });

  test("does not call discord.collectReplies (moved to collect-feedback node)", async () => {
    let called = false;
    const discord: DiscordAdapter = {
      sendMessage: async () => "msg",
      sendEmbed: async () => "msg",
      collectReplies: async () => {
        called = true;
        return [];
      },
      destroy: async () => {},
      getLatestMessageId: async () => "latest",
    };
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    await node(baseState);

    expect(called).toBe(false);
  });

  test("omits feedbackFromPrevious when state.userFeedback is empty or absent", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    await node({ ...baseState, userFeedback: [] });

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.feedbackFromPrevious).toBeUndefined();
  });

  test("stores discordLastSeenMessageId when no embed is sent", async () => {
    const fs = mockFs();
    const discord = mockDiscord();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    await node(baseState);

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.discordLastSeenMessageId).toBe("latest-channel-msg");
    expect(entry.discordMessageId).toBeUndefined();
  });

  test("does not store discordLastSeenMessageId when embed is sent", async () => {
    const fs = mockFs();
    const discord = mockDiscord();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, reason: "long session" },
      message: { body: "Stand up and stretch." },
    };
    await node(state);

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.discordMessageId).toBeTruthy();
    expect(entry.discordLastSeenMessageId).toBeUndefined();
  });

  test("handles getLatestMessageId returning null gracefully", async () => {
    const fs = mockFs();
    const discord = mockDiscord([], null);
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig, discord });

    await node(baseState);

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.discordLastSeenMessageId).toBeUndefined();
    expect(entry.discordMessageId).toBeUndefined();
  });

  test("prints one-line summary to stdout", async () => {
    const fs = mockFs();
    const node = createPersistNode({ fs, config: { logDir: "./logs" }, actionsConfig });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, reason: "long session" },
      message: { body: "Stand up and take a walk." },
    };

    // Capture console.log output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await node(state);
    } finally {
      console.log = origLog;
    }

    expect(logs.some(l => l.includes("nudge_break") && l.includes("Stand up"))).toBe(true);
  });
});
