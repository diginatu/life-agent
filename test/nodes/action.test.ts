import { test, expect, describe } from "bun:test";
import { createActionNode } from "../../src/nodes/action.ts";
import { ActionSelectionSchema } from "../../src/schemas/action.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

function mockFs(entries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => entries,
  };
}

function errorFs(): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
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

const fullPolicy = {
  availableActions: ["none", "log_only", "nudge_break", "nudge_sleep"],
  cooldownBlocked: false,
  quietHoursBlocked: false,
  reasons: [],
};

const restrictedPolicy = {
  availableActions: ["none", "log_only"],
  cooldownBlocked: true,
  quietHoursBlocked: false,
  reasons: ["cooldown active"],
};

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    summary: baseSummary,
    policy: fullPolicy,
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

  test("falls back to log_only on Ollama error", async () => {
    const node = createActionNode({ ollama: errorOllama(), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("ollama");
  });

  test("falls back to log_only on invalid JSON from Ollama", async () => {
    const node = createActionNode({ ollama: mockOllama("not json at all"), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("falls back to log_only on schema validation failure", async () => {
    const invalidAction = JSON.stringify({
      action: "invalid_action",
      priority: "low",
      reason: "test",
    });
    const node = createActionNode({ ollama: mockOllama(invalidAction), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("constrains action to availableActions from policy", async () => {
    // LLM returns nudge_break, but policy only allows none/log_only
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState({ policy: restrictedPolicy }));

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.some((e: string) => e.includes("not in available"))).toBe(true);
  });

  test("handles markdown-wrapped JSON response", async () => {
    const wrapped = "```json\n" + validActionJson + "\n```";
    const node = createActionNode({ ollama: mockOllama(wrapped), actionsConfig });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("nudge_break");
  });

  test("returns none-only with error when no summary", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node({ policy: fullPolicy });

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("returns none-only with error when no policy", async () => {
    const node = createActionNode({ ollama: mockOllama(), actionsConfig });
    const result = await node({ summary: baseSummary });

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("passes availableActions in prompt to Ollama", async () => {
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

    expect(capturedPrompt).toContain("23:45");
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
    decision: { action: "log_only", priority: "low", reason: "routine" },
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
      appendJsonLine: async () => {},
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
      appendJsonLine: async () => {},
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
