import { test, expect, describe } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { formatMemoryContext, loadMemoryContext } from "../../src/nodes/memory-context.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";

function fsReturning(entries: unknown[]): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => entries,
  };
}

function fsCapturingSince(entries: unknown[], capture: { since?: string }): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async () => [],
    readEntriesSince: async (_dir, since) => {
      capture.since = since;
      return entries;
    },
  };
}

describe("loadMemoryContext", () => {
  test("L3 + L2 + L1 all present: filters L2 by latestL3.windowEnd", async () => {
    const store = new InMemoryStore();
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 overview content",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 5,
    });
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 hour 6",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 2,
    });
    await store.put(["memory", "L2"], "2026-04-14T07", {
      content: "L2 hour 7",
      windowStart: "2026-04-14T07:00:00.000Z",
      windowEnd: "2026-04-14T08:00:00.000Z",
      sourceCount: 3,
    });
    await store.put(["memory", "L2"], "2026-04-14T04", {
      content: "L2 hour 4",
      windowStart: "2026-04-14T04:00:00.000Z",
      windowEnd: "2026-04-14T05:00:00.000Z",
      sourceCount: 1,
    });

    const l1 = [
      {
        timestamp: "2026-04-14T08:30:00.000Z",
        summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "reading", confidence: 0.8 },
        decision: { action: "none", priority: "low", reason: "l1 entry" },
      },
    ];

    const ctx = await loadMemoryContext({
      store,
      fs: fsReturning(l1),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });

    expect(ctx.l3Entries.map((e) => e.content)).toEqual(["L3 overview content"]);
    expect(ctx.l2Entries.map((e) => e.content)).toEqual(["L2 hour 6", "L2 hour 7"]);
    expect(ctx.l1Entries).toEqual(l1);
    expect(ctx.l4Content).toBeNull();
  });

  test("No L3: returns all L2 entries unfiltered, sorted by windowStart", async () => {
    const store = new InMemoryStore();
    await store.put(["memory", "L2"], "2026-04-14T07", {
      content: "L2 beta",
      windowStart: "2026-04-14T07:00:00.000Z",
      windowEnd: "2026-04-14T08:00:00.000Z",
      sourceCount: 1,
    });
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 alpha",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 2,
    });

    const ctx = await loadMemoryContext({
      store,
      fs: fsReturning([]),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });

    expect(ctx.l3Entries).toEqual([]);
    expect(ctx.l2Entries.map((e) => e.content)).toEqual(["L2 alpha", "L2 beta"]);
  });

  test("No L2: L1 cutoff is now - (1 + l2DelayHours) hours", async () => {
    const capture: { since?: string } = {};
    const store = new InMemoryStore();

    await loadMemoryContext({
      store,
      fs: fsCapturingSince([], capture),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });

    expect(capture.since).toBe("2026-04-14T08:00:00.000Z");
  });

  test("L2 present: L1 cutoff is latestL2.windowEnd (not L3.windowEnd)", async () => {
    const capture: { since?: string } = {};
    const store = new InMemoryStore();
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 content",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 2,
    });
    await store.put(["memory", "L2"], "2026-04-14T07", {
      content: "L2 hour 7",
      windowStart: "2026-04-14T07:00:00.000Z",
      windowEnd: "2026-04-14T08:00:00.000Z",
      sourceCount: 1,
    });

    await loadMemoryContext({
      store,
      fs: fsCapturingSince([], capture),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });

    expect(capture.since).toBe("2026-04-14T08:00:00.000Z");
  });

  test("L4 present: returns its content", async () => {
    const store = new InMemoryStore();
    await store.put(["memory", "L4"], "current", {
      content: "user prefers short break nudges; sleeps ~23:30",
      updatedAt: "2026-04-14T06:00:00.000Z",
      sourceCount: 3,
    });

    const ctx = await loadMemoryContext({
      store,
      fs: fsReturning([]),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });

    expect(ctx.l4Content).toBe("user prefers short break nudges; sleeps ~23:30");
  });

  test("L4 absent: l4Content is null", async () => {
    const store = new InMemoryStore();
    const ctx = await loadMemoryContext({
      store,
      fs: fsReturning([]),
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });

    expect(ctx.l4Content).toBeNull();
  });

  test("no store / no fs: returns empty layers", async () => {
    const ctx = await loadMemoryContext({
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });

    expect(ctx.l4Content).toBeNull();
    expect(ctx.l3Entries).toEqual([]);
    expect(ctx.l2Entries).toEqual([]);
    expect(ctx.l1Entries).toBeUndefined();
  });

  test("fs error is swallowed: l1Entries is undefined", async () => {
    const store = new InMemoryStore();
    const failingFs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [],
      readLastNLinesAcrossDays: async () => [],
      readAllLinesForDay: async () => [],
      readEntriesSince: async () => {
        throw new Error("fs down");
      },
    };

    const ctx = await loadMemoryContext({
      store,
      fs: failingFs,
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });

    expect(ctx.l1Entries).toBeUndefined();
  });
});

describe("formatMemoryContext", () => {
  test("all layers present: sections emitted in L4 → L3 → L2 → L1 order", () => {
    const out = formatMemoryContext({
      l4Content: "persistent facts",
      l3Entries: [
        {
          content: "L3a",
          windowStart: "2026-04-14T00:00:00.000Z",
          windowEnd: "2026-04-14T06:00:00.000Z",
        },
      ],
      l2Entries: [
        {
          content: "L2a",
          windowStart: "2026-04-14T06:00:00.000Z",
          windowEnd: "2026-04-14T07:00:00.000Z",
        },
      ],
      l1Entries: [
        {
          timestamp: "2026-04-14T08:00:00.000Z",
          summary: { posture: "sitting", activityGuess: "coding" },
          decision: { action: "none", reason: "r" },
        },
      ],
    });

    expect(out).toContain("Persistent memory");
    expect(out).toContain("persistent facts");
    expect(out).toContain("6-hour overview");
    expect(out).toContain("[2026-04-14T00:00:00.000Z..2026-04-14T06:00:00.000Z] L3a");
    expect(out).toContain("Hourly overview");
    expect(out).toContain("[2026-04-14T06:00:00.000Z] L2a");
    expect(out).toContain("Recent history");

    const l4Idx = out.indexOf("Persistent memory");
    const l3Idx = out.indexOf("6-hour overview");
    const l2Idx = out.indexOf("Hourly overview");
    const l1Idx = out.indexOf("Recent history");
    expect(l4Idx).toBeLessThan(l3Idx);
    expect(l3Idx).toBeLessThan(l2Idx);
    expect(l2Idx).toBeLessThan(l1Idx);
  });

  test("empty context: returns empty string", () => {
    const out = formatMemoryContext({
      l4Content: null,
      l3Entries: [],
      l2Entries: [],
      l1Entries: undefined,
    });
    expect(out).toBe("");
  });

  test("L4 with whitespace-only content: section omitted", () => {
    const out = formatMemoryContext({
      l4Content: "   \n\t  ",
      l3Entries: [],
      l2Entries: [],
      l1Entries: undefined,
    });
    expect(out).not.toContain("Persistent memory");
  });

  test("L1 provided but empty: Recent history section omitted", () => {
    const out = formatMemoryContext({
      l4Content: null,
      l3Entries: [],
      l2Entries: [],
      l1Entries: [],
    });
    expect(out).not.toContain("Recent history");
  });
});
