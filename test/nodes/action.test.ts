import { test, expect, describe } from "bun:test";
import { createActionNode } from "../../src/nodes/action.ts";
import { ActionSelectionSchema } from "../../src/schemas/action.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import { InMemoryStore } from "@langchain/langgraph";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

function mockFs(entries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => entries,
  };
}

function errorFs(): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => { throw new Error("fs read error"); },
  };
}

const validActionJson = JSON.stringify({
  action: "nudge_break",
  priority: "low",
  reason: "user has been sitting for a while",
});

function mockOllama(response = validActionJson): OllamaAdapter {
  return {
    generate: async () => response,
    generateWithImage: async () => response,
  };
}

function errorOllama(): OllamaAdapter {
  return {
    generate: async () => { throw new Error("ollama down"); },
    generateWithImage: async () => { throw new Error("ollama down"); },
  };
}

const baseSummary = {
  personPresent: true,
  posture: "sitting",
  scene: "desk with monitor",
  activityGuess: "coding",
  confidence: 0.85,
};

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    summary: baseSummary,
    ...overrides,
  };
}

describe("action node", () => {
  test("happy path: LLM selects valid action", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
    expect(result.decision!.priority).toBe("low");
    expect(result.decision!.reason).toBe("user has been sitting for a while");
  });

  test("output matches ActionSelectionSchema", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState());

    expect(ActionSelectionSchema.safeParse(result.decision).success).toBe(true);
  });

  test("falls back to none on Ollama error", async () => {
    const node = createActionNode({ ollama: errorOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("none");
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("ollama");
  });

  test("falls back to none on invalid JSON from Ollama", async () => {
    const node = createActionNode({ ollama: mockOllama("not json at all"), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("none");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("falls back to none on schema validation failure", async () => {
    const invalidSchema = JSON.stringify({
      action: 123,
      priority: "invalid_priority",
    });
    const node = createActionNode({ ollama: mockOllama(invalidSchema), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("none");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("handles markdown-wrapped JSON response", async () => {
    const wrapped = "```json\n" + validActionJson + "\n```";
    const node = createActionNode({ ollama: mockOllama(wrapped), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("nudge_break");
  });

  test("returns none-only with error when no summary", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node({});

    expect(result.decision!.action).toBe("none");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("passes all actions in prompt to Ollama", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState());

    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("nudge_sleep");
    expect(capturedPrompt).toContain("coding");
  });

  test("includes current time in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      now: () => new Date("2026-03-31T23:45:00"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("11:45 PM");
    expect(capturedPrompt).toContain("Tuesday");
  });

  test("default now() works when not provided", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.errors).toBeUndefined();
  });

  test("includes action descriptions from config in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState());

    expect(capturedPrompt).toContain("Suggest the user take a short break");
    expect(capturedPrompt).toContain("Suggest the user go to sleep");
  });
});

const historyEntries = [
  {
    timestamp: "2026-03-31T09:00:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.9 },
    decision: { action: "none", priority: "low", reason: "routine" },
  },
  {
    timestamp: "2026-03-31T10:00:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.85 },
    decision: { action: "nudge_break", priority: "medium", reason: "long session" },
  },
];

const digestEntry = {
  timestamp: "2026-03-31T08:00:00.000Z",
  tags: ["digest"],
  digestDate: "2026-03-30",
  content: "## Daily Summary\n\nYesterday was a productive day.",
};

describe("action node with history", () => {
  test("includes recent history in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFs(historyEntries),
      logDir: "./logs",
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("Recent history");
    expect(capturedPrompt).toContain("09:00");
    expect(capturedPrompt).toContain("coding");
    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("long session");
  });

  test("includes digest content in prompt when available", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFs([digestEntry, ...historyEntries]),
      logDir: "./logs",
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("Previous digests");
    expect(capturedPrompt).toContain("Yesterday was a productive day");
  });

  test("works fine with empty history", async () => {
    const node = createActionNode({
      ollama: mockOllama(),
      actionsConfig,
      fs: mockFs([]),
      logDir: "./logs",
    });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
    expect(result.errors).toBeUndefined();
  });

  test("handles filesystem error gracefully", async () => {
    const node = createActionNode({
      ollama: mockOllama(),
      actionsConfig,
      fs: errorFs(),
      logDir: "./logs",
    });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
    expect(result.errors).toBeUndefined();
  });

  test("reads history with configured count", async () => {
    let firstN = 0;
    let callCount = 0;
    const capturingFs: FilesystemAdapter = {
      appendJsonLine: async () => { },
      readLastNLines: async (_dir, _date, n) => {
        callCount++;
        if (callCount === 1) firstN = n;
        return historyEntries;
      },
    };
    const node = createActionNode({
      ollama: mockOllama(),
      actionsConfig,
      fs: capturingFs,
      logDir: "./logs",
      historyCount: 20,
    });
    await node(makeState());

    expect(firstN).toBe(20);
  });

  test("reads digests from multiple days when digestDays is set", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const dayDigests: Record<string, unknown[]> = {
      "2026-03-31": historyEntries,
      "2026-03-30": [
        { timestamp: "2026-03-30T20:00:00.000Z", tags: ["digest"], digestDate: "2026-03-30", content: "## March 30\n\nA relaxed day." },
      ],
      "2026-03-29": [
        { timestamp: "2026-03-29T20:00:00.000Z", tags: ["digest"], digestDate: "2026-03-29", content: "## March 29\n\nBusy coding day." },
      ],
    };
    const dateFs: FilesystemAdapter = {
      appendJsonLine: async () => { },
      readLastNLines: async (_dir, date) => dayDigests[date] ?? [],
    };
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: dateFs,
      logDir: "./logs",
      digestDays: 3,
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("A relaxed day");
    expect(capturedPrompt).toContain("Busy coding day");
    expect(capturedPrompt).toContain("2026-03-30");
    expect(capturedPrompt).toContain("2026-03-29");
  });

  test("skips digest section when digestDays is 0", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFs([digestEntry, ...historyEntries]),
      logDir: "./logs",
      digestDays: 0,
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).not.toContain("Previous digests");
    expect(capturedPrompt).not.toContain("Yesterday was a productive day");
    expect(capturedPrompt).toContain("Recent history");
  });

  test("includes user feedback from previous Discord message in history", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const entriesWithFeedback = [
      {
        ...historyEntries[0],
        feedbackFromPrevious: [
          { text: "Thanks, I will stretch now", userId: "u1", timestamp: "2026-03-31T09:05:00.000Z" },
        ],
      },
      historyEntries[1],
    ];
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFs(entriesWithFeedback),
      logDir: "./logs",
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("Thanks, I will stretch now");
  });

  test("works without fs deps (backward compatible)", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
  });
});

describe("action node with memory store", () => {
  test("includes memories in prompt when store has patterns", async () => {
    const store = new InMemoryStore();
    await store.put(["user", "patterns"], "sleep-late", {
      content: "User typically sleeps around 2am",
      category: "sleep",
      observedCount: 10,
    });
    await store.put(["user", "patterns"], "bath-routine", {
      content: "User takes bath before bed",
      category: "routine",
      observedCount: 5,
    });

    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    const config = { store } as LangGraphRunnableConfig;
    await node(makeState(), config);

    expect(capturedPrompt).toContain("Known user patterns");
    expect(capturedPrompt).toContain("sleeps around 2am");
    expect(capturedPrompt).toContain("bath before bed");
    expect(capturedPrompt).toContain("observed 10 times");
  });

  test("works without store (backward compatible)", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState());

    expect(capturedPrompt).not.toContain("Known user patterns");
    expect(capturedPrompt).toContain("personal assistant");
  });

  test("works with empty store", async () => {
    const store = new InMemoryStore();
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    const config = { store } as LangGraphRunnableConfig;
    await node(makeState(), config);

    expect(capturedPrompt).not.toContain("Known user patterns");
  });
});

describe("action node with action definitions in store", () => {
  test("uses store descriptions instead of config descriptions", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Learned: suggest break after 2h of focused coding",
      source: "learned",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    const config = { store } as LangGraphRunnableConfig;
    await node(makeState(), config);

    expect(capturedPrompt).toContain("Learned: suggest break after 2h of focused coding");
    expect(capturedPrompt).not.toContain("Suggest the user take a short break");
  });

  test("falls back to config description when store has no definition", async () => {
    const store = new InMemoryStore();
    await store.put(["actions", "definitions"], "nudge_break", {
      description: "Store version of break nudge",
      source: "seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    const config = { store } as LangGraphRunnableConfig;
    await node(makeState(), config);

    // nudge_break uses store description
    expect(capturedPrompt).toContain("Store version of break nudge");
    // nudge_sleep falls back to config description
    expect(capturedPrompt).toContain("Suggest the user go to sleep");
  });

  test("falls back to config descriptions when no store available", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState());

    expect(capturedPrompt).toContain("Suggest the user take a short break");
    expect(capturedPrompt).toContain("Suggest the user go to sleep");
  });
});
