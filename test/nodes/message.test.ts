import { test, expect, describe } from "bun:test";
import { createMessageNode } from "../../src/nodes/message.ts";
import { DraftMessageSchema } from "../../src/schemas/message.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const actionsConfig = mockActionsConfig();

const validMessageJson = JSON.stringify({
  title: "Time for a break!",
  body: "You've been coding for a while. Stand up and stretch your legs.",
});

function mockOllama(response = validMessageJson): OllamaAdapter {
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

function makeState(action: string, overrides: Record<string, unknown> = {}) {
  return {
    summary: baseSummary,
    decision: {
      action,
      priority: "low",
      reason: "test reason",
    },
    ...overrides,
  };
}

describe("message node", () => {
  test("skips message for none action", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState("none"));

    expect(result.message).toBeNull();
    expect(result.errors).toBeUndefined();
  });

  test("skips message for log_only action", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState("log_only"));

    expect(result.message).toBeNull();
    expect(result.errors).toBeUndefined();
  });

  test("drafts message for nudge_break", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message).toBeDefined();
    expect(result.message!.title).toBe("Time for a break!");
    expect(result.message!.body).toContain("coding");
  });

  test("drafts message for nudge_sleep", async () => {
    const sleepMessage = JSON.stringify({
      title: "Time to wind down",
      body: "It's getting late. Consider heading to bed.",
    });
    const node = createMessageNode({ ollama: mockOllama(sleepMessage), actionsConfig });
    const result = await node(makeState("nudge_sleep"));

    expect(result.message).toBeDefined();
    expect(result.message!.title).toBe("Time to wind down");
  });

  test("output matches DraftMessageSchema", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(DraftMessageSchema.safeParse(result.message).success).toBe(true);
  });

  test("falls back to default message on Ollama error", async () => {
    const node = createMessageNode({ ollama: errorOllama(), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message).toBeDefined();
    expect(result.message!.title.length).toBeGreaterThan(0);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("falls back to default message on invalid JSON", async () => {
    const node = createMessageNode({ ollama: mockOllama("not json"), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message).toBeDefined();
    expect(result.message!.title.length).toBeGreaterThan(0);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("handles markdown-wrapped JSON", async () => {
    const wrapped = "```json\n" + validMessageJson + "\n```";
    const node = createMessageNode({ ollama: mockOllama(wrapped), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message!.title).toBe("Time for a break!");
  });

  test("returns null message when no decision in state", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node({ summary: baseSummary });

    expect(result.message).toBeNull();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("passes context in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };
    const node = createMessageNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState("nudge_break"));

    expect(capturedPrompt).toContain("coding");
    expect(capturedPrompt).toContain("nudge_break");
  });

  test("includes action description from config in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };
    const node = createMessageNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState("nudge_break"));

    expect(capturedPrompt).toContain("Suggest the user take a short break");
  });
});
