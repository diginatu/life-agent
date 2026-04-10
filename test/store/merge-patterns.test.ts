import { describe, test, expect } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { mergeDuplicatePatterns, PATTERNS_NAMESPACE } from "../../src/store/merge-patterns.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";

function makeOllama(response: string): OllamaAdapter {
  return {
    generate: async () => response,
    generateWithImage: async () => "",
  };
}

async function seedPatterns(
  store: InMemoryStore,
  patterns: Array<{ key: string; content: string; category: string; observedCount: number; firstObserved: string; lastObserved: string }>,
) {
  for (const p of patterns) {
    await store.put(PATTERNS_NAMESPACE, p.key, {
      content: p.content,
      category: p.category,
      observedCount: p.observedCount,
      firstObserved: p.firstObserved,
      lastObserved: p.lastObserved,
    });
  }
}

describe("mergeDuplicatePatterns", () => {
  test("merges duplicate patterns into canonical key and deletes duplicates", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "late-night-bedroom-rest", content: "Resting in bedroom at night", category: "sleep", observedCount: 5, firstObserved: "2026-04-10T01:00:00.000Z", lastObserved: "2026-04-10T05:00:00.000Z" },
      { key: "late-night-rest-behavior", content: "Lying down late", category: "sleep", observedCount: 2, firstObserved: "2026-04-10T02:00:00.000Z", lastObserved: "2026-04-10T04:00:00.000Z" },
      { key: "late-night-posture-in-bedroom", content: "Lying posture at night", category: "sleep", observedCount: 3, firstObserved: "2026-04-09T23:00:00.000Z", lastObserved: "2026-04-10T06:00:00.000Z" },
      { key: "morning-coffee", content: "Coffee in the morning", category: "routine", observedCount: 4, firstObserved: "2026-04-01T08:00:00.000Z", lastObserved: "2026-04-10T08:00:00.000Z" },
    ]);

    const ollama = makeOllama(JSON.stringify({
      merges: [
        {
          canonical: "late-night-bedroom-rest",
          duplicates: ["late-night-rest-behavior", "late-night-posture-in-bedroom"],
          content: "User rests in bedroom during late-night hours",
          category: "sleep",
        },
      ],
    }));

    const result = await mergeDuplicatePatterns(store, ollama, { minCountToRun: 1 });

    expect(result.merged).toBe(2);

    const items = await store.search(PATTERNS_NAMESPACE, { limit: 50 });
    expect(items).toHaveLength(2);

    const canonical = await store.get(PATTERNS_NAMESPACE, "late-night-bedroom-rest");
    expect(canonical).not.toBeNull();
    expect(canonical!.value.observedCount).toBe(10);
    expect(canonical!.value.firstObserved).toBe("2026-04-09T23:00:00.000Z");
    expect(canonical!.value.lastObserved).toBe("2026-04-10T06:00:00.000Z");
    expect(canonical!.value.content).toBe("User rests in bedroom during late-night hours");

    expect(await store.get(PATTERNS_NAMESPACE, "late-night-rest-behavior")).toBeNull();
    expect(await store.get(PATTERNS_NAMESPACE, "late-night-posture-in-bedroom")).toBeNull();

    const untouched = await store.get(PATTERNS_NAMESPACE, "morning-coffee");
    expect(untouched).not.toBeNull();
    expect(untouched!.value.observedCount).toBe(4);
  });

  test("no-ops when pattern count below threshold", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "a", content: "x", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "b", content: "y", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
    ]);

    let called = false;
    const ollama: OllamaAdapter = {
      generate: async () => { called = true; return "{}"; },
      generateWithImage: async () => "",
    };

    const result = await mergeDuplicatePatterns(store, ollama, { minCountToRun: 5 });

    expect(called).toBe(false);
    expect(result.merged).toBe(0);
    const items = await store.search(PATTERNS_NAMESPACE, { limit: 10 });
    expect(items).toHaveLength(2);
  });

  test("canonical key that was not previously in store is created from merged duplicates", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "a", content: "A", category: "sleep", observedCount: 2, firstObserved: "2026-04-10T01:00:00.000Z", lastObserved: "2026-04-10T02:00:00.000Z" },
      { key: "b", content: "B", category: "sleep", observedCount: 3, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T03:00:00.000Z" },
    ]);

    const ollama = makeOllama(JSON.stringify({
      merges: [{ canonical: "late-night-rest", duplicates: ["a", "b"], content: "merged", category: "sleep" }],
    }));

    await mergeDuplicatePatterns(store, ollama, { minCountToRun: 1 });

    const canonical = await store.get(PATTERNS_NAMESPACE, "late-night-rest");
    expect(canonical).not.toBeNull();
    expect(canonical!.value.observedCount).toBe(5);
    expect(canonical!.value.firstObserved).toBe("2026-04-10T00:00:00.000Z");
    expect(canonical!.value.lastObserved).toBe("2026-04-10T03:00:00.000Z");
    expect(await store.get(PATTERNS_NAMESPACE, "a")).toBeNull();
    expect(await store.get(PATTERNS_NAMESPACE, "b")).toBeNull();
  });

  test("handles malformed LLM response without throwing", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "a", content: "A", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "b", content: "B", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
    ]);

    const ollama = makeOllama("not-json-garbage");

    const result = await mergeDuplicatePatterns(store, ollama, { minCountToRun: 1 });

    expect(result.merged).toBe(0);
    const items = await store.search(PATTERNS_NAMESPACE, { limit: 10 });
    expect(items).toHaveLength(2);
  });

  test("skips merge group where canonical is also listed in duplicates", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "a", content: "A", category: "sleep", observedCount: 2, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T01:00:00.000Z" },
      { key: "b", content: "B", category: "sleep", observedCount: 3, firstObserved: "2026-04-09T23:00:00.000Z", lastObserved: "2026-04-10T02:00:00.000Z" },
    ]);

    const ollama = makeOllama(JSON.stringify({
      merges: [{ canonical: "a", duplicates: ["a", "b"], content: "merged", category: "sleep" }],
    }));

    await mergeDuplicatePatterns(store, ollama, { minCountToRun: 1 });

    const canonical = await store.get(PATTERNS_NAMESPACE, "a");
    expect(canonical).not.toBeNull();
    expect(canonical!.value.observedCount).toBe(5);
    expect(canonical!.value.firstObserved).toBe("2026-04-09T23:00:00.000Z");
    expect(canonical!.value.lastObserved).toBe("2026-04-10T02:00:00.000Z");
    expect(await store.get(PATTERNS_NAMESPACE, "b")).toBeNull();
  });

  test("handles LLM response wrapped in code block", async () => {
    const store = new InMemoryStore();
    await seedPatterns(store, [
      { key: "a", content: "A", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
      { key: "b", content: "B", category: "sleep", observedCount: 1, firstObserved: "2026-04-10T00:00:00.000Z", lastObserved: "2026-04-10T00:00:00.000Z" },
    ]);

    const ollama = makeOllama("```json\n" + JSON.stringify({
      merges: [{ canonical: "a", duplicates: ["b"], content: "merged", category: "sleep" }],
    }) + "\n```");

    const result = await mergeDuplicatePatterns(store, ollama, { minCountToRun: 1 });
    expect(result.merged).toBe(1);
    expect(await store.get(PATTERNS_NAMESPACE, "b")).toBeNull();
  });
});
