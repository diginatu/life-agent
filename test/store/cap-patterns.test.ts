import { describe, test, expect } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { capUserPatterns } from "../../src/store/cap-patterns.ts";

const NS = ["user", "patterns"];

async function seed(store: InMemoryStore, entries: Array<{ key: string; observedCount: number; lastObserved: string }>) {
  for (const e of entries) {
    await store.put(NS, e.key, {
      content: e.key,
      category: "sleep",
      observedCount: e.observedCount,
      firstObserved: "2026-04-01T00:00:00.000Z",
      lastObserved: e.lastObserved,
    });
  }
}

async function keys(store: InMemoryStore): Promise<string[]> {
  const items = await store.search(NS, { limit: 100 });
  return items.map((i) => i.key).sort();
}

describe("capUserPatterns", () => {
  test("no-op when count is at or below cap", async () => {
    const store = new InMemoryStore();
    await seed(store, [
      { key: "a", observedCount: 1, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "b", observedCount: 2, lastObserved: "2026-04-10T01:00:00.000Z" },
    ]);

    const result = await capUserPatterns(store, { maxPatterns: 2 });

    expect(result.evicted).toBe(0);
    expect(await keys(store)).toEqual(["a", "b"]);
  });

  test("evicts lowest observedCount entries when over cap", async () => {
    const store = new InMemoryStore();
    await seed(store, [
      { key: "keep1", observedCount: 10, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "keep2", observedCount: 8, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "drop1", observedCount: 2, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "drop2", observedCount: 1, lastObserved: "2026-04-10T00:00:00.000Z" },
    ]);

    const result = await capUserPatterns(store, { maxPatterns: 2 });

    expect(result.evicted).toBe(2);
    expect(await keys(store)).toEqual(["keep1", "keep2"]);
  });

  test("ties on observedCount broken by older lastObserved (older evicted first)", async () => {
    const store = new InMemoryStore();
    await seed(store, [
      { key: "recent", observedCount: 3, lastObserved: "2026-04-10T12:00:00.000Z" },
      { key: "oldest", observedCount: 3, lastObserved: "2026-04-05T00:00:00.000Z" },
      { key: "middle", observedCount: 3, lastObserved: "2026-04-08T00:00:00.000Z" },
    ]);

    const result = await capUserPatterns(store, { maxPatterns: 2 });

    expect(result.evicted).toBe(1);
    expect(await keys(store)).toEqual(["middle", "recent"]);
  });

  test("evicts across both dimensions: lowest count first, then oldest", async () => {
    const store = new InMemoryStore();
    await seed(store, [
      { key: "high-recent", observedCount: 5, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "high-old", observedCount: 5, lastObserved: "2026-04-01T00:00:00.000Z" },
      { key: "low-recent", observedCount: 1, lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "low-old", observedCount: 1, lastObserved: "2026-04-01T00:00:00.000Z" },
    ]);

    const result = await capUserPatterns(store, { maxPatterns: 2 });

    expect(result.evicted).toBe(2);
    expect(await keys(store)).toEqual(["high-old", "high-recent"]);
  });

  test("defaults to a sane cap when no option provided", async () => {
    const store = new InMemoryStore();
    const many = Array.from({ length: 60 }, (_, i) => ({
      key: `p${i}`,
      observedCount: i,
      lastObserved: `2026-04-10T00:00:00.000Z`,
    }));
    await seed(store, many);

    const result = await capUserPatterns(store);

    expect(result.evicted).toBeGreaterThan(0);
    const remaining = await store.search(NS, { limit: 100 });
    expect(remaining.length).toBeLessThanOrEqual(50);
    expect(remaining.length).toBeGreaterThan(0);
  });

  test("handles missing observedCount as zero", async () => {
    const store = new InMemoryStore();
    await store.put(NS, "noCount", { content: "x", category: "sleep", lastObserved: "2026-04-10T00:00:00.000Z" });
    await store.put(NS, "hasCount", { content: "y", category: "sleep", observedCount: 1, lastObserved: "2026-04-10T00:00:00.000Z" });

    const result = await capUserPatterns(store, { maxPatterns: 1 });

    expect(result.evicted).toBe(1);
    expect(await keys(store)).toEqual(["hasCount"]);
  });
});
