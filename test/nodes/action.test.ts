import { test, expect, describe } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { createActionNode } from "../../src/nodes/action.ts";
import { ActionSelectionSchema } from "../../src/schemas/action.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

function mockFs(entries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => entries,
    readLastNLinesAcrossDays: async () => entries,
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => entries,
  };
}

function mockFsWithSince(entries: unknown[], sinceEntries: unknown[]): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => entries,
    readLastNLinesAcrossDays: async () => entries,
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => sinceEntries,
  };
}

function errorFs(): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => { throw new Error("fs read error"); },
    readLastNLinesAcrossDays: async () => { throw new Error("fs read error"); },
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => [],
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

  test("prompt does not contain Known user patterns or Previous digests", async () => {
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
    expect(capturedPrompt).not.toContain("Previous digests");
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

  test("readEntriesSince is called with a cutoff timestamp", async () => {
    let capturedSince: string | undefined;
    const capturingFs: FilesystemAdapter = {
      appendJsonLine: async () => { },
      readLastNLines: async () => [],
      readLastNLinesAcrossDays: async () => [],
      readAllLinesForDay: async () => [],
      readEntriesSince: async (_dir, since) => {
        capturedSince = since;
        return historyEntries;
      },
    };
    const now = new Date("2026-04-14T10:00:00.000Z");
    const node = createActionNode({
      ollama: mockOllama(),
      actionsConfig,
      fs: capturingFs,
      logDir: "./logs",
      l2DelayHours: 1,
      now: () => now,
    });
    await node(makeState());

    // With no L2 entries, cutoff = now - (1 + l2DelayHours) * 1h = now - 2h
    expect(capturedSince).toBe("2026-04-14T08:00:00.000Z");
  });

  test("includes sent message body in history", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const entriesWithMessage = [
      {
        ...historyEntries[0],
        decision: { action: "nudge_break", priority: "medium", reason: "long session" },
        message: { body: "Time for a stretch! You've been coding for a while." },
      },
      historyEntries[1],
    ];
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFs(entriesWithMessage),
      logDir: "./logs",
      now: () => new Date("2026-03-31T11:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("Time for a stretch! You've been coding for a while.");
  });

  test("does not show sent message line for entries with no message", async () => {
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

    expect(capturedPrompt).not.toContain("agent message:");
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

  test("includes latest user reply section from state.userFeedback in prompt", async () => {
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
    await node(
      makeState({
        userFeedback: [
          { text: "I'm on a call, skip nudges", userId: "u1", timestamp: "2026-03-31T10:55:00.000Z" },
        ],
      }),
    );

    expect(capturedPrompt).toContain("Latest user reply");
    expect(capturedPrompt).toContain("I'm on a call, skip nudges");
    // Latest user reply must appear BEFORE Recent history in prompt order
    const replyIdx = capturedPrompt.indexOf("Latest user reply");
    const historyIdx = capturedPrompt.indexOf("Recent history");
    expect(replyIdx).toBeGreaterThan(-1);
    expect(historyIdx).toBeGreaterThan(-1);
    expect(replyIdx).toBeLessThan(historyIdx);
  });

  test("does not include Latest user reply section when userFeedback is empty or absent", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const node = createActionNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState({ userFeedback: [] }));

    expect(capturedPrompt).not.toContain("Latest user reply");
  });

  test("prompt warns not to reply when there is no new user feedback", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const replyConfig = mockActionsConfig({
      reply: { active: true, description: "Reply to the user feedback", fallback: { body: "fallback" } },
    });
    const node = createActionNode({ ollama: capturingOllama, actionsConfig: replyConfig });
    await node(makeState({ userFeedback: [] }));

    expect(capturedPrompt).toContain("reply");
    expect(capturedPrompt).toMatch(/no new user messages/i);
  });

  test("prompt does not warn about reply when there IS new user feedback", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const replyConfig = mockActionsConfig({
      reply: { active: true, description: "Reply to the user feedback", fallback: { body: "fallback" } },
    });
    const node = createActionNode({ ollama: capturingOllama, actionsConfig: replyConfig });
    await node(makeState({
      userFeedback: [{ text: "hello", userId: "u1", timestamp: "2026-03-31T10:00:00.000Z" }],
    }));

    expect(capturedPrompt).toContain("Latest user reply");
    expect(capturedPrompt).not.toMatch(/no new user messages/i);
  });

  test("prompt instructs to acknowledge user when feedback is present", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };
    const replyConfig = mockActionsConfig({
      reply: { active: true, description: "Reply to the user feedback", fallback: { body: "fallback" } },
    });
    const node = createActionNode({ ollama: capturingOllama, actionsConfig: replyConfig });
    await node(makeState({
      userFeedback: [{ text: "hello", userId: "u1", timestamp: "2026-03-31T10:00:00.000Z" }],
    }));

    expect(capturedPrompt).toMatch(/user has sent a new message/i);
    expect(capturedPrompt).toMatch(/do not choose.*none/i);
  });

  test("works without fs deps (backward compatible)", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
  });
});

// ---------------------------------------------------------------------------
// L2/L3 memory layer consumption tests
// ---------------------------------------------------------------------------

const l1Entries = [
  {
    timestamp: "2026-04-14T08:05:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.9 },
    decision: { action: "none", priority: "low", reason: "l1 entry one" },
  },
  {
    timestamp: "2026-04-14T08:30:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "reading", confidence: 0.8 },
    decision: { action: "nudge_break", priority: "medium", reason: "l1 entry two" },
  },
];

describe("action node with L2/L3 memory layers", () => {
  test("L3 + L2 + L1 all present: correct sections, no gap, no overlap", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const store = new InMemoryStore();
    // L3 entry: windowEnd = "2026-04-14T06:00:00.000Z"
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 overview content",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 5,
    });

    // L2 entries
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
    // This L2 entry's windowStart < L3.windowEnd — should be excluded
    await store.put(["memory", "L2"], "2026-04-14T04", {
      content: "L2 hour 4",
      windowStart: "2026-04-14T04:00:00.000Z",
      windowEnd: "2026-04-14T05:00:00.000Z",
      sourceCount: 1,
    });

    // L1 entries: timestamps after max L2 windowEnd (2026-04-14T08:00:00.000Z)
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFsWithSince([], l1Entries),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("6-hour overview");
    expect(capturedPrompt).toContain("L3 overview content");
    expect(capturedPrompt).toContain("Hourly overview");
    expect(capturedPrompt).toContain("L2 hour 7");
    expect(capturedPrompt).toContain("L2 hour 6"); // windowStart == L3.windowEnd, >= so included
    expect(capturedPrompt).not.toContain("L2 hour 4"); // windowStart < L3.windowEnd, excluded
    expect(capturedPrompt).toContain("Recent history");
    expect(capturedPrompt).toContain("l1 entry one");
  });

  test("No L3: all L2 entries appear in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const store = new InMemoryStore();
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 alpha",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 2,
    });
    await store.put(["memory", "L2"], "2026-04-14T07", {
      content: "L2 beta",
      windowStart: "2026-04-14T07:00:00.000Z",
      windowEnd: "2026-04-14T08:00:00.000Z",
      sourceCount: 1,
    });

    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFsWithSince([], []),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).toContain("Hourly overview");
    expect(capturedPrompt).toContain("L2 alpha");
    expect(capturedPrompt).toContain("L2 beta");
    expect(capturedPrompt).not.toContain("6-hour overview");
  });

  test("No L2: L1 bounded by now - (l2DelayHours + 1h)", async () => {
    let capturedSince: string | undefined;
    const store = new InMemoryStore();
    const capturingFs: FilesystemAdapter = {
      appendJsonLine: async () => { },
      readLastNLines: async () => [],
      readLastNLinesAcrossDays: async () => [],
      readAllLinesForDay: async () => [],
      readEntriesSince: async (_dir, since) => {
        capturedSince = since;
        return [{ timestamp: "2026-04-14T09:00:00.000Z", summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "l1 no l2", confidence: 0.7 }, decision: { action: "none", priority: "low", reason: "no l2 entry" } }];
      },
    };

    // now = 10:00, l2DelayHours = 1, cutoff = now - 2h = 08:00
    let capturedPrompt = "";
    const node = createActionNode({
      ollama: {
        generate: async (prompt) => { capturedPrompt = prompt; return validActionJson; },
        generateWithImage: async () => validActionJson,
      },
      actionsConfig,
      fs: capturingFs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedSince).toBe("2026-04-14T08:00:00.000Z");
    expect(capturedPrompt).toContain("Recent history");
    expect(capturedPrompt).toContain("no l2 entry");
  });

  test("L1 cutoff is taken from latestL2WindowEnd (not L3)", async () => {
    let capturedSince: string | undefined;
    const store = new InMemoryStore();
    // L3 entry: windowEnd "2026-04-14T06:00:00.000Z"
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 content",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 2,
    });
    // L2 entry: windowEnd "2026-04-14T08:00:00.000Z"
    await store.put(["memory", "L2"], "2026-04-14T07", {
      content: "L2 hour 7",
      windowStart: "2026-04-14T07:00:00.000Z",
      windowEnd: "2026-04-14T08:00:00.000Z",
      sourceCount: 1,
    });

    const capturingFs: FilesystemAdapter = {
      appendJsonLine: async () => { },
      readLastNLines: async () => [],
      readLastNLinesAcrossDays: async () => [],
      readAllLinesForDay: async () => [],
      readEntriesSince: async (_dir, since) => {
        capturedSince = since;
        return [];
      },
    };

    const node = createActionNode({
      ollama: mockOllama(),
      actionsConfig,
      fs: capturingFs,
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });
    await node(makeState());

    // Should use L2 windowEnd "2026-04-14T08:00:00.000Z", NOT L3 windowEnd "2026-04-14T06:00:00.000Z"
    expect(capturedSince).toBe("2026-04-14T08:00:00.000Z");
  });

  test("All empty: L3/L2/L1 sections all omitted", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validActionJson;
      },
      generateWithImage: async () => validActionJson,
    };

    const store = new InMemoryStore();
    const node = createActionNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFsWithSince([], []),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T10:00:00.000Z"),
    });
    await node(makeState());

    expect(capturedPrompt).not.toContain("6-hour overview");
    expect(capturedPrompt).not.toContain("Hourly overview");
    expect(capturedPrompt).not.toContain("Recent history");
  });
});
