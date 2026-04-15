import { test, expect, describe } from "bun:test";
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
  };
}

function errorFs(): FilesystemAdapter {
  return {
    appendJsonLine: async () => { },
    readLastNLines: async () => { throw new Error("fs read error"); },
    readLastNLinesAcrossDays: async () => { throw new Error("fs read error"); },
    readAllLinesForDay: async () => [],
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
      readLastNLinesAcrossDays: async (_dir, _date, n) => {
        callCount++;
        if (callCount === 1) firstN = n;
        return historyEntries;
      },
      readAllLinesForDay: async () => [],
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
