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
function mockFs(
  entriesByDate: Record<string, unknown[]> = {},
): FilesystemAdapter & { pruneEntriesBefore(dir: string, beforeIso: string): Promise<void> } {
  const state = Object.fromEntries(
    Object.entries(entriesByDate).map(([date, entries]) => [date, [...entries]]),
  ) as Record<string, unknown[]>;

  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async (_dir, date) => [...(state[date] ?? [])],
    readEntriesSince: async () => [],
    pruneEntriesBefore: async (_dir, beforeIso) => {
      const boundaryDate = beforeIso.slice(0, 10);

      for (const date of Object.keys(state)) {
        if (date < boundaryDate) {
          delete state[date];
          continue;
        }

        if (date === boundaryDate) {
          state[date] = state[date]!.filter((entry) => {
            const timestamp = (entry as { timestamp?: string }).timestamp;
            return timestamp == null || timestamp >= beforeIso;
          });
          if (state[date]!.length === 0) {
            delete state[date];
          }
        }
      }
    },
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

// --- L3 test fixtures ---
// Bucket B = 2026-04-15T06:00:00Z (aligned to 06:00 UTC)
// B+6h     = 2026-04-15T12:00:00Z
// With l3DelayHours=6: eligible when now >= B+6h+6h = 2026-04-15T18:00:00Z
const L3_BUCKET_B = new Date("2026-04-15T06:00:00.000Z");
const L3_BUCKET_B_END = new Date("2026-04-15T12:00:00.000Z");
const TICK_L3_ELIGIBLE = new Date("2026-04-15T18:01:00.000Z"); // B+6h+l3DelayHours+1min
const TICK_L3_NOT_YET  = new Date("2026-04-15T17:59:00.000Z"); // B+6h+l3DelayHours-1min

// L2 entries placed in [B, B+6h)
const l2EntriesForBucket = [
  { content: "l2 hour 06 summary", windowStart: "2026-04-15T06:00:00.000Z", windowEnd: "2026-04-15T07:00:00.000Z", sourceCount: 3 },
  { content: "l2 hour 07 summary", windowStart: "2026-04-15T07:00:00.000Z", windowEnd: "2026-04-15T08:00:00.000Z", sourceCount: 2 },
];

/** Seed the given store with L2 entries for the bucket. */
async function seedL2(store: InMemoryStore, entries: typeof l2EntriesForBucket): Promise<void> {
  for (const entry of entries) {
    const key = entry.windowStart.slice(0, 13).replace("T", "T"); // "2026-04-15T06"
    await store.put(["memory", "L2"], key, entry);
  }
}

describe("createLayerUpdateNode — L3 6-hour bucket rollup", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("eligible tick: writes L3 key for bucket B when delay has elapsed", async () => {
    await seedL2(store, l2EntriesForBucket);
    const node = createLayerUpdateNode({
      ollama: mockOllama("6h summary"),
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    const bucketKey = "2026-04-15T06";
    const item = await store.get(["memory", "L3"], bucketKey);
    expect(item).not.toBeNull();
    expect(item!.value.content).toBe("6h summary");
    expect(item!.value.sourceCount).toBe(2);
    expect(item!.value.windowStart).toBe(L3_BUCKET_B.toISOString());
    expect(item!.value.windowEnd).toBe(L3_BUCKET_B_END.toISOString());
  });

  test("L3 prompt includes L2 content text, not raw LogEntry fields", async () => {
    await seedL2(store, l2EntriesForBucket);
    const capturedPrompts: string[] = [];
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt: string) => { capturedPrompts.push(prompt); return "6h summary"; },
      generateWithImage: async () => "",
    };
    const node = createLayerUpdateNode({
      ollama: capturingOllama,
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    // Find the L3 summarization prompt (not L2 — there are no L1 entries to trigger L2)
    expect(capturedPrompts.length).toBeGreaterThanOrEqual(1);
    const l3Prompt = capturedPrompts[capturedPrompts.length - 1]!;
    // Must contain L2 content strings
    expect(l3Prompt).toContain("l2 hour 06 summary");
    expect(l3Prompt).toContain("l2 hour 07 summary");
    // Must NOT contain "unknown" fallback from formatHistory misapplied to L2 items
    expect(l3Prompt).not.toContain("unknown, unknown");
  });

  test("not-yet tick: no L3 write when delay has not elapsed", async () => {
    await seedL2(store, l2EntriesForBucket);
    const node = createLayerUpdateNode({
      ollama: mockOllama("6h summary"),
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_NOT_YET,
    });
    await node();

    const bucketKey = "2026-04-15T06";
    const item = await store.get(["memory", "L3"], bucketKey);
    expect(item).toBeNull();
  });

  test("idempotent: existing L3 key prevents LLM call and overwrite", async () => {
    await seedL2(store, l2EntriesForBucket);
    const bucketKey = "2026-04-15T06";
    await store.put(["memory", "L3"], bucketKey, {
      content: "already written",
      windowStart: L3_BUCKET_B.toISOString(),
      windowEnd: L3_BUCKET_B_END.toISOString(),
      sourceCount: 1,
    });

    let generateCalled = false;
    const capturingOllama: OllamaAdapter = {
      generate: async () => { generateCalled = true; return "new summary"; },
      generateWithImage: async () => "",
    };
    const node = createLayerUpdateNode({
      ollama: capturingOllama,
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    expect(generateCalled).toBe(false);
    const item = await store.get(["memory", "L3"], bucketKey);
    expect(item!.value.content).toBe("already written");
  });

  test("empty bucket: no L2 entries in bucket → no L3 write", async () => {
    // Seed L2 entries OUTSIDE the bucket [B, B+6h)
    await store.put(["memory", "L2"], "2026-04-15T00", {
      content: "midnight hour",
      windowStart: "2026-04-15T00:00:00.000Z",
      windowEnd: "2026-04-15T01:00:00.000Z",
      sourceCount: 1,
    });
    const node = createLayerUpdateNode({
      ollama: mockOllama("should not be called"),
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    const bucketKey = "2026-04-15T06";
    const item = await store.get(["memory", "L3"], bucketKey);
    expect(item).toBeNull();
  });

  test("catch-up: multiple past buckets all written in one tick", async () => {
    // Seed two buckets: 2026-04-15T06 and 2026-04-15T00
    const bucket00L2 = [
      { content: "early hour summary", windowStart: "2026-04-15T00:00:00.000Z", windowEnd: "2026-04-15T01:00:00.000Z", sourceCount: 2 },
    ];
    await seedL2(store, l2EntriesForBucket);           // bucket T06
    await seedL2(store, bucket00L2);                   // bucket T00

    // now = T18:01, so both T00 bucket (T00+6h+6h = T12 <= T18:01) and T06 bucket (T06+6h+6h = T18 <= T18:01) are eligible
    const node = createLayerUpdateNode({
      ollama: mockOllama("summary"),
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L3"], { limit: 100 });
    const l3Keys = results.map((r: { key: string }) => r.key);
    expect(l3Keys).toContain("2026-04-15T06");
    expect(l3Keys).toContain("2026-04-15T00");
  });
});

describe("createLayerUpdateNode — retention eviction", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("L2 retention: evicts oldest entries when over l2MaxRetention limit", async () => {
    const l2MaxRetention = 3;
    // Seed 4 L2 entries older than the new tick's eligible window
    const seedKeys = [
      "2026-04-10T10",
      "2026-04-10T11",
      "2026-04-10T12",
      "2026-04-10T13",
    ];
    for (const key of seedKeys) {
      await store.put(["memory", "L2"], key, {
        content: `summary for ${key}`,
        windowStart: `${key}:00:00.000Z`,
        windowEnd: `${key}:59:59.000Z`,
        sourceCount: 1,
      });
    }

    // TICK_ELIGIBLE (2026-04-15T12:01Z) causes a new L2 entry for 2026-04-15T10
    const fs = mockFs({ "2026-04-15": entriesInH });
    const node = createLayerUpdateNode({
      ollama: mockOllama("new summary"),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 9999,
      l2MaxRetention,
      l3MaxRetention: 9999,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L2"], { limit: 10000 });
    expect(results).toHaveLength(l2MaxRetention);
    // Oldest entries should be evicted: 2026-04-10T10 and 2026-04-10T11
    const keys = results.map((r: { key: string }) => r.key);
    expect(keys).not.toContain("2026-04-10T10");
    expect(keys).not.toContain("2026-04-10T11");
    // Newer entries should remain
    expect(keys).toContain("2026-04-10T12");
    expect(keys).toContain("2026-04-10T13");
    expect(keys).toContain(localHourKey(HOUR_H));
  });

  test("L3 retention: evicts oldest entries when over l3MaxRetention limit", async () => {
    const l3MaxRetention = 2;
    // Seed 3 existing L3 entries
    const oldL3Keys = [
      { key: "2026-04-12T00", ws: "2026-04-12T00:00:00.000Z" },
      { key: "2026-04-12T06", ws: "2026-04-12T06:00:00.000Z" },
      { key: "2026-04-12T12", ws: "2026-04-12T12:00:00.000Z" },
    ];
    for (const { key, ws } of oldL3Keys) {
      await store.put(["memory", "L3"], key, {
        content: `l3 summary ${key}`,
        windowStart: ws,
        windowEnd: new Date(new Date(ws).getTime() + 6 * 3600000).toISOString(),
        sourceCount: 1,
      });
    }
    // Seed L2 entries for bucket 2026-04-15T06 so a new L3 entry is written
    await seedL2(store, l2EntriesForBucket);

    const node = createLayerUpdateNode({
      ollama: mockOllama("new l3 summary"),
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention,
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L3"], { limit: 10000 });
    expect(results).toHaveLength(l3MaxRetention);
    const keys = results.map((r: { key: string }) => r.key);
    // Oldest should be evicted
    expect(keys).not.toContain("2026-04-12T00");
    expect(keys).not.toContain("2026-04-12T06");
    // Newer entries remain
    expect(keys).toContain("2026-04-12T12");
    expect(keys).toContain("2026-04-15T06");
  });

  test("L3 eviction: distills evicted L3 entries into L4 persistent memory", async () => {
    const l3MaxRetention = 1;
    // Seed 2 old L3 entries — one will be evicted
    await store.put(["memory", "L3"], "2026-04-12T00", {
      content: "old summary A",
      windowStart: "2026-04-12T00:00:00.000Z",
      windowEnd: "2026-04-12T06:00:00.000Z",
      sourceCount: 1,
    });
    await store.put(["memory", "L3"], "2026-04-12T06", {
      content: "old summary B",
      windowStart: "2026-04-12T06:00:00.000Z",
      windowEnd: "2026-04-12T12:00:00.000Z",
      sourceCount: 1,
    });
    // Seed L2 for bucket T06 so a new L3 is written this tick
    await seedL2(store, l2EntriesForBucket);

    const l4Prompts: string[] = [];
    const l4Ollama: OllamaAdapter = {
      generate: async (prompt: string) => {
        if (prompt.includes("PERSISTENT_MEMORY_PROMPT")) {
          l4Prompts.push(prompt);
          return `L4 rev ${l4Prompts.length}`;
        }
        return "summary text";
      },
      generateWithImage: async () => "",
    };

    const node = createLayerUpdateNode({
      ollama: l4Ollama,
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention,
      l4MaxChars: 2000,
      l4UpdatePrompt: "PERSISTENT_MEMORY_PROMPT cur={l4Current} evict={l3Content} ws={l3WindowStart} we={l3WindowEnd}",
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    // Two entries evicted (started with 2 old + 1 new = 3, limit 1 → evict oldest 2)
    expect(l4Prompts).toHaveLength(2);
    // First eviction: oldest L3 entry, empty current L4
    expect(l4Prompts[0]).toContain("cur=");
    expect(l4Prompts[0]).toContain("evict=old summary A");
    expect(l4Prompts[0]).toContain("ws=2026-04-12T00:00:00.000Z");
    // Second eviction: current L4 is "L4 rev 1"
    expect(l4Prompts[1]).toContain("cur=L4 rev 1");
    expect(l4Prompts[1]).toContain("evict=old summary B");

    // L4 store entry
    const l4 = await store.get(["memory", "L4"], "current");
    expect(l4).not.toBeNull();
    expect(l4!.value.content).toBe("L4 rev 2");
    expect(l4!.value.sourceCount).toBe(2);
    expect(typeof l4!.value.updatedAt).toBe("string");

    // L3 count respects retention
    const l3After = await store.search(["memory", "L3"], { limit: 100 });
    expect(l3After).toHaveLength(l3MaxRetention);
  });

  test("no L4 update when nothing evicted", async () => {
    await seedL2(store, l2EntriesForBucket);
    let l4Called = false;
    const ollama: OllamaAdapter = {
      generate: async (prompt: string) => {
        if (prompt.includes("PERSISTENT_MEMORY_PROMPT")) l4Called = true;
        return "x";
      },
      generateWithImage: async () => "",
    };
    const node = createLayerUpdateNode({
      ollama,
      fs: mockFs(),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      l4MaxChars: 2000,
      l4UpdatePrompt: "PERSISTENT_MEMORY_PROMPT {l4Current} {l3Content}",
      now: () => TICK_L3_ELIGIBLE,
    });
    await node();

    expect(l4Called).toBe(false);
    const l4 = await store.get(["memory", "L4"], "current");
    expect(l4).toBeNull();
  });

  test("no eviction when count is at or under limit", async () => {
    // Seed exactly l2MaxRetention entries; after writing one new entry that already exists,
    // count stays at max and no eviction occurs
    const l2MaxRetention = 5;
    for (let i = 0; i < l2MaxRetention; i++) {
      const key = `2026-04-10T${String(i).padStart(2, '0')}`;
      await store.put(["memory", "L2"], key, {
        content: `summary ${key}`,
        windowStart: `${key}:00:00.000Z`,
        windowEnd: `${key}:59:59.000Z`,
        sourceCount: 1,
      });
    }

    // No new L2 entry written (no entries in fs), count stays <= max
    const fs = mockFs({});
    const node = createLayerUpdateNode({
      ollama: mockOllama(),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 9999,
      l2MaxRetention,
      l3MaxRetention: 9999,
      now: () => TICK_ELIGIBLE,
    });
    await node();

    const results = await store.search(["memory", "L2"], { limit: 10000 });
    expect(results).toHaveLength(l2MaxRetention);
  });
});

describe("createLayerUpdateNode — L2 eviction deferred until after L3", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("L3 consumes L2 entries before eviction during multi-day catch-up", async () => {
    // Scenario: 4 hours of L1 data across 2 L3 buckets, l2MaxRetention=2.
    // Old code evicts L2 per-write → L3 for bucket T00 finds no L2 entries.
    // Fixed code defers eviction → L3 for both buckets gets created.
    const l1Entries: Record<string, unknown[]> = {
      "2026-04-15": [
        { timestamp: "2026-04-15T01:05:00.000Z", summary: { activityGuess: "sleep", posture: "lying" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T02:10:00.000Z", summary: { activityGuess: "sleep", posture: "lying" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T07:15:00.000Z", summary: { activityGuess: "coding", posture: "sitting" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T08:20:00.000Z", summary: { activityGuess: "coding", posture: "sitting" }, decision: { action: "none", reason: "r" } },
      ],
    };

    const node = createLayerUpdateNode({
      ollama: mockOllama("summary"),
      fs: mockFs(l1Entries),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 2,
      l3MaxRetention: 9999,
      now: () => new Date("2026-04-15T18:01:00.000Z"),
    });
    await node();

    // Both L3 buckets should be created
    const l3Results = await store.search(["memory", "L3"], { limit: 100 });
    const l3Keys = l3Results.map((r: { key: string }) => r.key);
    expect(l3Keys).toContain("2026-04-15T00"); // bucket T00-T06
    expect(l3Keys).toContain("2026-04-15T06"); // bucket T06-T12
  });

  test("L2 eviction still occurs after L3, respecting retention limit", async () => {
    const l1Entries: Record<string, unknown[]> = {
      "2026-04-15": [
        { timestamp: "2026-04-15T01:05:00.000Z", summary: { activityGuess: "a", posture: "p" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T02:10:00.000Z", summary: { activityGuess: "a", posture: "p" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T07:15:00.000Z", summary: { activityGuess: "a", posture: "p" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T08:20:00.000Z", summary: { activityGuess: "a", posture: "p" }, decision: { action: "none", reason: "r" } },
      ],
    };

    const node = createLayerUpdateNode({
      ollama: mockOllama("summary"),
      fs: mockFs(l1Entries),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 2,
      l3MaxRetention: 9999,
      now: () => new Date("2026-04-15T18:01:00.000Z"),
    });
    await node();

    // After run, L2 should be capped at l2MaxRetention=2
    const l2Results = await store.search(["memory", "L2"], { limit: 10000 });
    expect(l2Results).toHaveLength(2);

    // Oldest entries (T01, T02) should be evicted, newest (T07, T08) remain
    const l2Keys = l2Results.map((r: { key: string }) => r.key);
    expect(l2Keys).toContain(localHourKey(new Date("2026-04-15T07:00:00.000Z")));
    expect(l2Keys).toContain(localHourKey(new Date("2026-04-15T08:00:00.000Z")));
  });
});

describe("createLayerUpdateNode — L1 pruning", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("prunes raw logs after L3 rollup so evicted old L2 hours are not re-summarized", async () => {
    const fs = mockFs({
      "2026-04-15": [
        { timestamp: "2026-04-15T01:05:00.000Z", summary: { activityGuess: "sleep", posture: "lying" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T02:10:00.000Z", summary: { activityGuess: "sleep", posture: "lying" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T07:15:00.000Z", summary: { activityGuess: "coding", posture: "sitting" }, decision: { action: "none", reason: "r" } },
        { timestamp: "2026-04-15T08:20:00.000Z", summary: { activityGuess: "coding", posture: "sitting" }, decision: { action: "none", reason: "r" } },
      ],
    });

    const firstRun = createLayerUpdateNode({
      ollama: mockOllama("summary"),
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 2,
      l3MaxRetention: 9999,
      now: () => new Date("2026-04-15T18:01:00.000Z"),
    });
    await firstRun();

    let secondRunGenerateCount = 0;
    const countingOllama: OllamaAdapter = {
      generate: async () => {
        secondRunGenerateCount += 1;
        return "summary";
      },
      generateWithImage: async () => "",
    };

    const secondRun = createLayerUpdateNode({
      ollama: countingOllama,
      fs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 2,
      l3MaxRetention: 9999,
      now: () => new Date("2026-04-15T18:15:00.000Z"),
    });
    await secondRun();

    expect(secondRunGenerateCount).toBe(0);
  });
});

describe("createLayerUpdateNode — maxScanDays", () => {
  let store: InMemoryStore;
  beforeEach(() => { store = new InMemoryStore(); });

  test("maxScanDays controls how far back L2 scan reaches", async () => {
    // Entry 9 days ago. Default MAX_SCAN_DAYS=7 would miss it; maxScanDays=10 should find it.
    const now = new Date("2026-04-15T18:01:00.000Z");
    const nineDaysAgo = new Date(now.getTime() - 9 * 86400000);
    const dateStr = nineDaysAgo.toISOString().slice(0, 10);
    const entryTimestamp = new Date(nineDaysAgo.getTime() + 5 * 60000).toISOString(); // +5min

    const l1Entries: Record<string, unknown[]> = {
      [dateStr]: [
        { timestamp: entryTimestamp, summary: { activityGuess: "reading", posture: "sitting" }, decision: { action: "none", reason: "r" } },
      ],
    };

    const node = createLayerUpdateNode({
      ollama: mockOllama("old summary"),
      fs: mockFs(l1Entries),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      l3DelayHours: 6,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
      maxScanDays: 10,
      now: () => now,
    });
    await node();

    // Should find L2 entry for that old hour
    const results = await store.search(["memory", "L2"], { limit: 10000 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Verify at least one entry has the old date
    const hasOldEntry = results.some((r: { value: { windowStart?: string } }) =>
      r.value.windowStart?.startsWith(dateStr)
    );
    expect(hasOldEntry).toBe(true);
  });
});

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
      l3DelayHours: 9999,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
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
      l3DelayHours: 9999,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
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
      l3DelayHours: 9999,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
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
      l3DelayHours: 9999,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
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
      l3DelayHours: 9999,
      l2MaxRetention: 9999,
      l3MaxRetention: 9999,
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
