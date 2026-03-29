import { test, expect, describe } from "bun:test";
import { createPersistNode } from "../../src/nodes/persist.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import type { NotifierAdapter } from "../../src/adapters/notifier.ts";

function mockFs(): FilesystemAdapter & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    appendJsonLine: async (_dir, _date, data) => { written.push(data); },
    readLastNLines: async () => [],
  };
}

function mockNotifier(): NotifierAdapter & { notifications: Array<{ title: string; body: string }> } {
  const notifications: Array<{ title: string; body: string }> = [];
  return {
    notifications,
    notify: async (title, body) => { notifications.push({ title, body }); },
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
    availableActions: ["none", "log_only", "nudge_break", "nudge_sleep"] as const,
    cooldownBlocked: false,
    quietHoursBlocked: false,
    reasons: [],
  },
  decision: {
    action: "log_only" as const,
    priority: "low" as const,
    reason: "routine",
  },
  message: null,
  errors: [] as string[],
};

describe("persist node", () => {
  test("writes log entry to filesystem", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    await node(baseState);

    expect(fs.written.length).toBe(1);
    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.eventId).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.capture).toBeDefined();
    expect(entry.decision).toBeDefined();
  });

  test("does not notify for log_only action", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    await node(baseState);

    expect(notifier.notifications.length).toBe(0);
  });

  test("does not notify for none action", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    await node({ ...baseState, decision: { action: "none" as const, priority: "low" as const, reason: "nothing" } });

    expect(notifier.notifications.length).toBe(0);
  });

  test("sends notification for nudge_break with message", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, priority: "medium" as const, reason: "long session" },
      message: { title: "Break time!", body: "Stand up and stretch." },
    };
    await node(state);

    expect(notifier.notifications.length).toBe(1);
    expect(notifier.notifications[0]!.title).toBe("Break time!");
    expect(notifier.notifications[0]!.body).toBe("Stand up and stretch.");
  });

  test("sends notification for nudge_sleep with message", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    const state = {
      ...baseState,
      decision: { action: "nudge_sleep" as const, priority: "high" as const, reason: "late night" },
      message: { title: "Bedtime", body: "Time to sleep." },
    };
    await node(state);

    expect(notifier.notifications.length).toBe(1);
    expect(notifier.notifications[0]!.title).toBe("Bedtime");
  });

  test("includes errors in log entry", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    await node({ ...baseState, errors: ["some error"] });

    const entry = fs.written[0] as Record<string, unknown>;
    expect(entry.errors).toEqual(["some error"]);
  });

  test("handles fs write error gracefully", async () => {
    const failingFs: FilesystemAdapter = {
      appendJsonLine: async () => { throw new Error("disk full"); },
      readLastNLines: async () => [],
    };
    const notifier = mockNotifier();
    const node = createPersistNode({ fs: failingFs, notifier, config: { logDir: "./logs" } });

    const result = await node(baseState);

    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("disk full");
  });

  test("still writes log even when no decision", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    const state = { ...baseState, decision: undefined };
    await node(state);

    expect(fs.written.length).toBe(1);
  });

  test("prints one-line summary to stdout", async () => {
    const fs = mockFs();
    const notifier = mockNotifier();
    const node = createPersistNode({ fs, notifier, config: { logDir: "./logs" } });

    const state = {
      ...baseState,
      decision: { action: "nudge_break" as const, priority: "medium" as const, reason: "long session" },
      message: { title: "Break time!", body: "Stand up." },
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

    expect(logs.some(l => l.includes("nudge_break") && l.includes("Break time!"))).toBe(true);
  });
});
