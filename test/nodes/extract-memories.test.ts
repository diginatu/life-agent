import { describe, test, expect } from "bun:test";
import { createExtractMemoriesNode } from "../../src/nodes/extract-memories.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import { InMemoryStore } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

function makeState(overrides = {}) {
  return {
    summary: {
      personPresent: true,
      posture: "sitting",
      scene: "Person at desk with laptop",
      activityGuess: "coding",
      confidence: 0.9,
    },
    decision: {
      action: "log_only",
      priority: "low" as const,
      reason: "normal activity",
    },
    ...overrides,
  };
}

function makeConfig(store?: InMemoryStore): LangGraphRunnableConfig {
  return { store } as LangGraphRunnableConfig;
}

describe("extract_memories node", () => {
  test("extracts new pattern and writes to store", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify([
        { key: "sleep-late", content: "User is active at 2am, likely a night owl", category: "sleep" },
      ]),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const items = await store.search(["user", "patterns"], { limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("sleep-late");
    expect(items[0].value.content).toBe("User is active at 2am, likely a night owl");
    expect(items[0].value.category).toBe("sleep");
    expect(items[0].value.observedCount).toBe(1);
  });

  test("returns empty array when LLM finds no patterns", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => "[]",
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    const result = await node(makeState(), makeConfig(store));

    const items = await store.search(["user", "patterns"], { limit: 10 });
    expect(items).toHaveLength(0);
    expect(result.errors).toBeUndefined();
  });

  test("increments observedCount for existing pattern", async () => {
    const store = new InMemoryStore();
    // Seed an existing memory
    await store.put(["user", "patterns"], "sleep-late", {
      content: "User is a night owl",
      category: "sleep",
      observedCount: 3,
      firstObserved: "2026-03-28T00:00:00.000Z",
      lastObserved: "2026-03-30T00:00:00.000Z",
    });

    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify([
        { key: "sleep-late", content: "User is active at 2am, confirmed night owl", category: "sleep" },
      ]),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const item = await store.get(["user", "patterns"], "sleep-late");
    expect(item).not.toBeNull();
    expect(item!.value.observedCount).toBe(4);
    expect(item!.value.firstObserved).toBe("2026-03-28T00:00:00.000Z");
    expect(item!.value.content).toBe("User is active at 2am, confirmed night owl");
  });

  test("completes without error when store is unavailable", async () => {
    const ollama: OllamaAdapter = {
      generate: async () => "[]",
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    const result = await node(makeState(), makeConfig(undefined));

    expect(result.errors).toBeUndefined();
  });

  test("completes without error when LLM returns malformed JSON", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => "this is not json at all",
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    const result = await node(makeState(), makeConfig(store));

    const items = await store.search(["user", "patterns"], { limit: 10 });
    expect(items).toHaveLength(0);
    expect(result.errors).toBeUndefined();
  });

  test("includes existing memories in LLM prompt", async () => {
    const store = new InMemoryStore();
    await store.put(["user", "patterns"], "existing-pattern", {
      content: "User drinks coffee in the morning",
      category: "routine",
      observedCount: 5,
      firstObserved: "2026-03-25T00:00:00.000Z",
      lastObserved: "2026-03-30T00:00:00.000Z",
    });

    let capturedPrompt = "";
    const ollama: OllamaAdapter = {
      generate: async (prompt: string) => {
        capturedPrompt = prompt;
        return "[]";
      },
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    expect(capturedPrompt).toContain("coffee in the morning");
    expect(capturedPrompt).toContain("existing-pattern");
  });

  test("includes current observation in LLM prompt", async () => {
    const store = new InMemoryStore();
    let capturedPrompt = "";
    const ollama: OllamaAdapter = {
      generate: async (prompt: string) => {
        capturedPrompt = prompt;
        return "[]";
      },
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState({ summary: { personPresent: true, posture: "standing", scene: "Kitchen", activityGuess: "cooking", confidence: 0.8 } }), makeConfig(store));

    expect(capturedPrompt).toContain("cooking");
    expect(capturedPrompt).toContain("standing");
  });

  test("skips extraction when no summary in state", async () => {
    const store = new InMemoryStore();
    let called = false;
    const ollama: OllamaAdapter = {
      generate: async () => { called = true; return "[]"; },
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node({ summary: undefined, decision: undefined }, makeConfig(store));

    expect(called).toBe(false);
  });

  test("handles LLM response wrapped in code block", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => "```json\n[\n  { \"key\": \"bath-routine\", \"content\": \"Takes bath before bed\", \"category\": \"routine\" }\n]\n```",
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const items = await store.search(["user", "patterns"], { limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("bath-routine");
  });
});
