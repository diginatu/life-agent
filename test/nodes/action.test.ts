import { test, expect, describe } from "bun:test";
import { createActionNode } from "../../src/nodes/action.ts";
import { ActionSelectionSchema } from "../../src/schemas/action.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";

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
    const node = createActionNode({ ollama: mockOllama() });
    const result = await node(makeState());

    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
    expect(result.decision!.priority).toBe("low");
    expect(result.decision!.reason).toBe("user has been sitting for a while");
  });

  test("output matches ActionSelectionSchema", async () => {
    const node = createActionNode({ ollama: mockOllama() });
    const result = await node(makeState());

    expect(ActionSelectionSchema.safeParse(result.decision).success).toBe(true);
  });

  test("falls back to log_only on Ollama error", async () => {
    const node = createActionNode({ ollama: errorOllama() });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("ollama");
  });

  test("falls back to log_only on invalid JSON from Ollama", async () => {
    const node = createActionNode({ ollama: mockOllama("not json at all") });
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
    const node = createActionNode({ ollama: mockOllama(invalidAction) });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("constrains action to availableActions from policy", async () => {
    // LLM returns nudge_break, but policy only allows none/log_only
    const node = createActionNode({ ollama: mockOllama() });
    const result = await node(makeState({ policy: restrictedPolicy }));

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.some((e: string) => e.includes("not in available"))).toBe(true);
  });

  test("handles markdown-wrapped JSON response", async () => {
    const wrapped = "```json\n" + validActionJson + "\n```";
    const node = createActionNode({ ollama: mockOllama(wrapped) });
    const result = await node(makeState());

    expect(result.decision!.action).toBe("nudge_break");
  });

  test("returns none-only with error when no summary", async () => {
    const node = createActionNode({ ollama: mockOllama() });
    const result = await node({ policy: fullPolicy });

    expect(result.decision!.action).toBe("log_only");
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("returns none-only with error when no policy", async () => {
    const node = createActionNode({ ollama: mockOllama() });
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
    const node = createActionNode({ ollama: capturingOllama });
    await node(makeState());

    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("nudge_sleep");
    expect(capturedPrompt).toContain("coding");
  });
});
