import { test, expect, describe, beforeEach } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { createLayerUpdateNode } from "../../src/nodes/layer-update.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";

function localHourKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}`;
}

function mockOllama(response = "hourly summary"): OllamaAdapter {
  return {
    generate: async () => response,
    generateWithImage: async () => response,
  };
}

// entriesByDate: date string (UTC, e.g. "2026-04-15") -> array of log entries
function mockFs(entriesByDate: Record<string, unknown[]> = {}): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async (_dir, date) => entriesByDate[date] ?? [],
  };
}

// Fixed reference time: UTC 2026-04-15T12:00:00Z
// With l2DelayHours=1 and the delay check: H+1h+1h <= now
// Eligible hours (UTC): any H such that H+2h <= 12:00 => H <= 10:00
// So H=10:00 UTC is eligible at tick=12:01, not at 11:59
const HOUR_H = new Date("2026-04-15T10:00:00.000Z"); // the target hour
const TICK_ELIGIBLE = new Date("2026-04-15T12:01:00.000Z"); // H+1h+l2DelayHours+1min
const TICK_NOT_YET = new Date("2026-04-15T11:59:00.000Z");  // H+1h+l2DelayHours-1min

const entriesInH: { timestamp: string; summary: { activityGuess: string; posture: string }; decision: { action: string; reason: string } }[] = [
  {
    timestamp: "2026-04-15T10:05:00.000Z",
    summary: { activityGuess: "coding", posture: "sitting" },
    decision: { action: "none", reason: "routine" },
  },
  {
    timestamp: "2026-04-15T10:30:00.000Z",
    summary: { activityGuess: "coding", posture: "sitting" },
    decision: { action: "nudge_break", reason: "long session" },
  },
];

describe("createLayerUpdateNode — L2 hourly rollup", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("writes L2 for eligible hour when delay has elapsed", async () => {
    const fs = mockFs({ "2026-04-15": entriesInH });
    const node = createLayerUpdateNode({
      ollama: mockOllama("hourly summary"),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    const expectedKey = localHourKey(HOUR_H);
    const item = await store.get(["memory", "L2"], expectedKey);
    expect(item).not.toBeNull();
    expect(item!.value.content).toBe("hourly summary");
    expect(item!.value.sourceCount).toBe(2);
    expect(typeof item!.value.windowStart).toBe("string");
    expect(typeof item!.value.windowEnd).toBe("string");
  });

  test("does NOT write L2 when delay has not elapsed yet", async () => {
    const fs = mockFs({ "2026-04-15": entriesInH });
    const node = createLayerUpdateNode({
      ollama: mockOllama(),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => TICK_NOT_YET,
    });
    await node();

    const expectedKey = localHourKey(HOUR_H);
    const item = await store.get(["memory", "L2"], expectedKey);
    expect(item).toBeNull();
  });

  test("is idempotent: does not overwrite existing L2 entry", async () => {
    const expectedKey = localHourKey(HOUR_H);
    await store.put(["memory", "L2"], expectedKey, {
      content: "already written",
      windowStart: HOUR_H.toISOString(),
      windowEnd: new Date(HOUR_H.getTime() + 3600000).toISOString(),
      sourceCount: 1,
    });

    let generateCalled = false;
    const capturingOllama: OllamaAdapter = {
      generate: async () => { generateCalled = true; return "new summary"; },
      generateWithImage: async () => "",
    };
    const fs = mockFs({ "2026-04-15": entriesInH });
    const node = createLayerUpdateNode({
      ollama: capturingOllama,
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    expect(generateCalled).toBe(false);
    const item = await store.get(["memory", "L2"], expectedKey);
    expect(item!.value.content).toBe("already written");
  });

  test("skips hour with zero L1 entries", async () => {
    const fs = mockFs({}); // no entries for any date
    const node = createLayerUpdateNode({
      ollama: mockOllama(),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L2"]);
    expect(results).toHaveLength(0);
  });

  test("catch-up: writes L2 for multiple past eligible hours in one tick", async () => {
    // H-1h = 09:00, H = 10:00 — both eligible at tick 12:01
    const HOUR_MINUS1 = new Date("2026-04-15T09:00:00.000Z");
    const entriesInHMinus1 = [
      {
        timestamp: "2026-04-15T09:10:00.000Z",
        summary: { activityGuess: "reading", posture: "sitting" },
        decision: { action: "none", reason: "quiet" },
      },
    ];
    const fs = mockFs({
      "2026-04-15": [...entriesInHMinus1, ...entriesInH],
    });
    const node = createLayerUpdateNode({
      ollama: mockOllama("summary"),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L2"], { limit: 100 });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const keys = results.map((r: { key: string }) => r.key);
    expect(keys).toContain(localHourKey(HOUR_H));
    expect(keys).toContain(localHourKey(HOUR_MINUS1));
  });
});
