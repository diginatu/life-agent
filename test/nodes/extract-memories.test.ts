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
      action: "none",
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
      generate: async () => JSON.stringify({
        patterns: [
          { key: "sleep-late", content: "User is active at 2am, likely a night owl", category: "sleep" },
        ],
        actionUpdates: [],
      }),
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

  test("prompt renders Time in local 12-hour format", async () => {
    const store = new InMemoryStore();
    let capturedPrompt = "";
    const ollama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({ patterns: [], actionUpdates: [] });
      },
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    expect(capturedPrompt).toMatch(/Time: \w+, \d{4}-\d{2}-\d{2} \d{2}:\d{2} (AM|PM)/);
  });

  test("returns empty array when LLM finds no patterns", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify({ patterns: [], actionUpdates: [] }),
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
      generate: async () => JSON.stringify({
        patterns: [
          { key: "sleep-late", content: "User is active at 2am, confirmed night owl", category: "sleep" },
        ],
        actionUpdates: [],
      }),
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
      generate: async () => JSON.stringify({ patterns: [], actionUpdates: [] }),
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
      generate: async () => "```json\n" + JSON.stringify({
        patterns: [{ key: "bath-routine", content: "Takes bath before bed", category: "routine" }],
        actionUpdates: [],
      }) + "\n```",
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const items = await store.search(["user", "patterns"], { limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("bath-routine");
  });
});

describe("extract_memories action definition evolution", () => {
  test("updates action definition in store when LLM returns actionUpdates", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Suggest the user take a short break",
      source: "learned",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify({
        patterns: [],
        actionUpdates: [
          { key: "nudge_break", description: "Suggest break after 2h of focused coding — user responds well to this" },
        ],
      }),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const item = await store.get(["actions", "definitions"], "nudge_break");
    expect(item).not.toBeNull();
    expect(item!.value.description).toBe("Suggest break after 2h of focused coding — user responds well to this");
    expect(item!.value.source).toBe("learned");
  });

  test("does not overwrite seed-sourced action definitions", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Suggest the user take a short break",
      source: "seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify({
        patterns: [],
        actionUpdates: [
          { key: "nudge_break", description: "LLM-proposed override that should be ignored" },
        ],
      }),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const item = await store.get(["actions", "definitions"], "nudge_break");
    expect(item).not.toBeNull();
    expect(item!.value.description).toBe("Suggest the user take a short break");
    expect(item!.value.source).toBe("seed");
    expect(item!.value.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("leaves action definitions unchanged when actionUpdates is empty", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Original description",
      source: "seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify({
        patterns: [],
        actionUpdates: [],
      }),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    const item = await store.get(["actions", "definitions"], "nudge_break");
    expect(item!.value.description).toBe("Original description");
    expect(item!.value.source).toBe("seed");
  });

  test("includes current action definitions in LLM prompt", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Suggest the user take a short break",
      source: "seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
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

    expect(capturedPrompt).toContain("Current Action Definitions");
    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("Suggest the user take a short break");
  });

  test("includes user feedback from state in LLM prompt", async () => {
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
    await node(
      makeState({
        userFeedback: [
          { text: "stop nagging me about water", userId: "u1", timestamp: "2026-04-12T10:15:00.000Z" },
        ],
      }),
      makeConfig(store),
    );

    expect(capturedPrompt).toContain("stop nagging me about water");
    expect(capturedPrompt).toMatch(/user reply/i);
  });

  test("includes recent log history in LLM prompt when fs and logDir provided", async () => {
    const store = new InMemoryStore();
    let capturedPrompt = "";
    const ollama: OllamaAdapter = {
      generate: async (prompt: string) => {
        capturedPrompt = prompt;
        return "[]";
      },
      generateWithImage: async () => "",
    };

    const fs = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        {
          timestamp: "2026-04-12T09:30:00.000Z",
          summary: { posture: "sitting", activityGuess: "coding" },
          decision: { action: "nudge_break", reason: "2h since last break" },
        },
        {
          timestamp: "2026-04-12T09:45:00.000Z",
          summary: { posture: "standing", activityGuess: "stretching" },
          decision: { action: "none", reason: "good activity" },
          feedbackFromPrevious: [
            { text: "thanks for the reminder", userId: "u1", timestamp: "2026-04-12T09:40:00.000Z" },
          ],
        },
      ],
      readLastNLinesAcrossDays: async () => [
        {
          timestamp: "2026-04-12T09:30:00.000Z",
          summary: { posture: "sitting", activityGuess: "coding" },
          decision: { action: "nudge_break", reason: "2h since last break" },
        },
        {
          timestamp: "2026-04-12T09:45:00.000Z",
          summary: { posture: "standing", activityGuess: "stretching" },
          decision: { action: "none", reason: "good activity" },
          feedbackFromPrevious: [
            { text: "thanks for the reminder", userId: "u1", timestamp: "2026-04-12T09:40:00.000Z" },
          ],
        },
      ],
    };

    const node = createExtractMemoriesNode({
      ollama,
      fs,
      logDir: "/fake/logs",
      historyCount: 10,
    });
    await node(makeState(), makeConfig(store));

    expect(capturedPrompt).toMatch(/Recent History/i);
    expect(capturedPrompt).toContain("coding");
    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("stretching");
    expect(capturedPrompt).toContain("thanks for the reminder");
  });

  test("continues without error when readLastNLines throws", async () => {
    const store = new InMemoryStore();
    const ollama: OllamaAdapter = {
      generate: async () => "[]",
      generateWithImage: async () => "",
    };

    const fs = {
      appendJsonLine: async () => {},
      readLastNLines: async () => { throw new Error("disk gone"); },
      readLastNLinesAcrossDays: async () => { throw new Error("disk gone"); },
    };

    const node = createExtractMemoriesNode({
      ollama,
      fs,
      logDir: "/fake/logs",
    });
    const result = await node(makeState(), makeConfig(store));

    expect(result.errors).toBeUndefined();
  });

  test("processes both patterns and actionUpdates in same response", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_sleep", {
      description: "Suggest sleep",
      source: "learned",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const ollama: OllamaAdapter = {
      generate: async () => JSON.stringify({
        patterns: [
          { key: "codes-at-night", content: "User codes late at night", category: "activity" },
        ],
        actionUpdates: [
          { key: "nudge_sleep", description: "Suggest sleep when coding past midnight" },
        ],
      }),
      generateWithImage: async () => "",
    };

    const node = createExtractMemoriesNode({ ollama });
    await node(makeState(), makeConfig(store));

    // Pattern was written
    const pattern = await store.get(["user", "patterns"], "codes-at-night");
    expect(pattern).not.toBeNull();
    expect(pattern!.value.content).toBe("User codes late at night");

    // Action definition was updated
    const def = await store.get(["actions", "definitions"], "nudge_sleep");
    expect(def!.value.description).toBe("Suggest sleep when coding past midnight");
    expect(def!.value.source).toBe("learned");
  });
});
