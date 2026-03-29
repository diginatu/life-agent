import { test, expect, describe } from "bun:test";
import { createPolicyNode } from "../../src/nodes/policy.ts";
import { PolicyDecisionSchema } from "../../src/schemas/policy.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";

function mockFs(lastEntries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => lastEntries,
  };
}

const defaultConfig = {
  quietHoursStart: 23,
  quietHoursEnd: 7,
  cooldownMinutes: 30,
  confidenceThreshold: 0.3,
  logDir: "./logs",
};

const baseSummary = {
  personPresent: true,
  posture: "sitting",
  scene: "desk with monitor",
  activityGuess: "coding",
  confidence: 0.85,
};

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    summary: { ...baseSummary, ...overrides },
  };
}

describe("policy node", () => {
  describe("quiet hours", () => {
    test("restricts to passive actions during quiet hours (2am)", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T02:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.quietHoursBlocked).toBe(true);
      expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
      expect(result.policy!.reasons.some((r: string) => r.includes("quiet"))).toBe(true);
    });

    test("allows all actions outside quiet hours (2pm)", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.quietHoursBlocked).toBe(false);
      expect(result.policy!.availableActions).toEqual(["none", "log_only", "nudge_break", "nudge_sleep"]);
    });

    test("restricts at start of quiet hours (11pm)", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T23:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.quietHoursBlocked).toBe(true);
      expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
    });

    test("allows all actions at end of quiet hours (7am)", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T07:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.quietHoursBlocked).toBe(false);
    });
  });

  describe("cooldown", () => {
    test("restricts when last action was recent", async () => {
      const recentEntry = {
        timestamp: "2026-03-29T13:50:00.000Z",
        decision: { action: "nudge_break" },
      };
      const node = createPolicyNode({
        fs: mockFs([recentEntry]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.cooldownBlocked).toBe(true);
      expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
    });

    test("allows all when last action was long ago", async () => {
      const oldEntry = {
        timestamp: "2026-03-29T13:00:00.000Z",
        decision: { action: "nudge_break" },
      };
      const node = createPolicyNode({
        fs: mockFs([oldEntry]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.cooldownBlocked).toBe(false);
    });

    test("allows all when last action was log_only (no cooldown for passive actions)", async () => {
      const recentLogOnly = {
        timestamp: "2026-03-29T13:55:00.000Z",
        decision: { action: "log_only" },
      };
      const node = createPolicyNode({
        fs: mockFs([recentLogOnly]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.cooldownBlocked).toBe(false);
    });

    test("allows all when no previous entries", async () => {
      const node = createPolicyNode({
        fs: mockFs([]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.cooldownBlocked).toBe(false);
      expect(result.policy!.availableActions).toEqual(["none", "log_only", "nudge_break", "nudge_sleep"]);
    });
  });

  describe("confidence threshold", () => {
    test("restricts when confidence is below threshold", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState({ confidence: 0.1 }));
      expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
      expect(result.policy!.reasons.some((r: string) => r.includes("confidence"))).toBe(true);
    });

    test("allows all when confidence meets threshold", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState({ confidence: 0.5 }));
      expect(result.policy!.reasons.every((r: string) => !r.includes("confidence"))).toBe(true);
    });
  });

  describe("duplicate suppression", () => {
    test("restricts when scene and activity match last entry", async () => {
      const lastEntry = {
        timestamp: "2026-03-29T13:50:00.000Z",
        decision: { action: "log_only" },
        summary: {
          scene: "desk with monitor",
          activityGuess: "coding",
        },
      };
      const node = createPolicyNode({
        fs: mockFs([lastEntry]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
      expect(result.policy!.reasons.some((r: string) => r.includes("duplicate"))).toBe(true);
    });

    test("allows all when activity differs from last entry", async () => {
      const lastEntry = {
        timestamp: "2026-03-29T13:50:00.000Z",
        decision: { action: "log_only" },
        summary: {
          scene: "desk with monitor",
          activityGuess: "reading",
        },
      };
      const node = createPolicyNode({
        fs: mockFs([lastEntry]),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(result.policy!.reasons.every((r: string) => !r.includes("duplicate"))).toBe(true);
    });
  });

  describe("schema validation", () => {
    test("output matches PolicyDecisionSchema", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node(makeState());
      expect(PolicyDecisionSchema.safeParse(result.policy).success).toBe(true);
    });
  });

  describe("no summary in state", () => {
    test("returns none-only with error", async () => {
      const node = createPolicyNode({
        fs: mockFs(),
        config: defaultConfig,
        now: () => new Date("2026-03-29T14:00:00.000Z"),
      });

      const result = await node({});
      expect(result.policy!.availableActions).toEqual(["none"]);
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });
});
