import { test, expect, describe } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { createMessageNode } from "../../src/nodes/message.ts";
import { DraftMessageSchema } from "../../src/schemas/message.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

function mockFsSince(entries: unknown[]): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
    readLastNLinesAcrossDays: async () => [],
    readAllLinesForDay: async () => [],
    readEntriesSince: async () => entries,
  };
}

const actionsConfig = mockActionsConfig();

const validMessageJson = JSON.stringify({
  body: "Time for a break! You've been coding for a while — stand up and stretch your legs.",
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

  test("drafts message for nudge_break", async () => {
    const node = createMessageNode({ ollama: mockOllama(), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message).toBeDefined();
    expect(result.message!.body).toContain("coding");
  });

  test("drafts message for nudge_sleep", async () => {
    const sleepMessage = JSON.stringify({
      body: "It's getting late. Consider heading to bed.",
    });
    const node = createMessageNode({ ollama: mockOllama(sleepMessage), actionsConfig });
    const result = await node(makeState("nudge_sleep"));

    expect(result.message).toBeDefined();
    expect(result.message!.body).toContain("bed");
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
    expect(result.message!.body.length).toBeGreaterThan(0);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("falls back to default message on invalid JSON", async () => {
    const node = createMessageNode({ ollama: mockOllama("not json"), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message).toBeDefined();
    expect(result.message!.body.length).toBeGreaterThan(0);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("handles markdown-wrapped JSON", async () => {
    const wrapped = "```json\n" + validMessageJson + "\n```";
    const node = createMessageNode({ ollama: mockOllama(wrapped), actionsConfig });
    const result = await node(makeState("nudge_break"));

    expect(result.message!.body).toContain("coding");
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

  test("injects responseStyle from config into prompt", async () => {
    const styledConfig = mockActionsConfig({}, { responseStyle: "日本語、優しい口調" });
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };
    const node = createMessageNode({ ollama: capturingOllama, actionsConfig: styledConfig });
    await node(makeState("nudge_break"));

    expect(capturedPrompt).toContain("日本語、優しい口調");
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

describe("message node with memory layers", () => {
  test("L4 + L3 + L2 + L1 all appear in prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };

    const store = new InMemoryStore();
    await store.put(["memory", "L4"], "current", {
      content: "user prefers short nudges",
      updatedAt: "2026-04-14T06:00:00.000Z",
      sourceCount: 3,
    });
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 overview msg",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 5,
    });
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 msg hour 6",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 2,
    });

    const l1 = [
      {
        timestamp: "2026-04-14T08:05:00.000Z",
        summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.9 },
        decision: { action: "none", reason: "l1 msg entry" },
      },
    ];

    const node = createMessageNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFsSince(l1),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });
    await node(makeState("nudge_break"));

    expect(capturedPrompt).toContain("Persistent memory");
    expect(capturedPrompt).toContain("user prefers short nudges");
    expect(capturedPrompt).toContain("6-hour overview");
    expect(capturedPrompt).toContain("L3 overview msg");
    expect(capturedPrompt).toContain("Hourly overview");
    expect(capturedPrompt).toContain("L2 msg hour 6");
    expect(capturedPrompt).toContain("Recent history");
    expect(capturedPrompt).toContain("l1 msg entry");
  });

  test("memory timestamps in prompt are shown in local time", async () => {
    // This test captures the prompt produced by the message node and verifies
    // that L3 and L2 window timestamps are formatted in local time inside the
    // memory section. We compute the expected local-format strings dynamically
    // so the test is timezone-independent.
    let capturedPrompt = "";

    const now = () => new Date("2026-04-14T09:00:00.000Z");

    const store = new InMemoryStore();
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 overview msg",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 1,
    });
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 msg hour 6",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 1,
    });

    // Capture the prompt via a fake Ollama adapter
    let capturedPromptLocal = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt: string) => {
        capturedPromptLocal = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };

    const node = createMessageNode({ ollama: capturingOllama, actionsConfig, store, fs: mockFsSince([]), logDir: "./logs", l2DelayHours: 1, now });
    await node(makeState("nudge_break"));

    // Helper to format an ISO UTC timestamp to local YYYY-MM-DDTHH:MM:SS
    function localIso(iso: string) {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const s = String(d.getSeconds()).padStart(2, "0");
      return `${y}-${m}-${day}T${h}:${min}:${s}`;
    }

    // Confirm memory labels present
    expect(capturedPromptLocal).toContain("6-hour overview");
    expect(capturedPromptLocal).toContain("Hourly overview");

    // Expect the prompt to contain the local-formatted timestamps
    expect(capturedPromptLocal).toContain(localIso("2026-04-14T00:00:00.000Z"));
    expect(capturedPromptLocal).toContain(localIso("2026-04-14T06:00:00.000Z"));
  });

  test("No memory deps: no memory sections in prompt", async () => {
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

    expect(capturedPrompt).not.toContain("Persistent memory");
    expect(capturedPrompt).not.toContain("6-hour overview");
    expect(capturedPrompt).not.toContain("Hourly overview");
    expect(capturedPrompt).not.toContain("Recent history");
  });

  test("L2 filtered by latestL3.windowEnd (matches action node behavior)", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };

    const store = new InMemoryStore();
    await store.put(["memory", "L3"], "2026-04-14T00", {
      content: "L3 content",
      windowStart: "2026-04-14T00:00:00.000Z",
      windowEnd: "2026-04-14T06:00:00.000Z",
      sourceCount: 5,
    });
    // Before L3.windowEnd — excluded
    await store.put(["memory", "L2"], "2026-04-14T04", {
      content: "L2 stale hour 4",
      windowStart: "2026-04-14T04:00:00.000Z",
      windowEnd: "2026-04-14T05:00:00.000Z",
      sourceCount: 1,
    });
    // At L3.windowEnd boundary — included
    await store.put(["memory", "L2"], "2026-04-14T06", {
      content: "L2 fresh hour 6",
      windowStart: "2026-04-14T06:00:00.000Z",
      windowEnd: "2026-04-14T07:00:00.000Z",
      sourceCount: 2,
    });

    const node = createMessageNode({
      ollama: capturingOllama,
      actionsConfig,
      fs: mockFsSince([]),
      logDir: "./logs",
      store,
      l2DelayHours: 1,
      now: () => new Date("2026-04-14T09:00:00.000Z"),
    });
    await node(makeState("nudge_break"));

    expect(capturedPrompt).toContain("L2 fresh hour 6");
    expect(capturedPrompt).not.toContain("L2 stale hour 4");
  });
});

describe("message node with user feedback", () => {
  test("includes user feedback replies in LLM prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt: string) => {
        capturedPrompt = prompt;
        return validMessageJson;
      },
      generateWithImage: async () => validMessageJson,
    };
    const node = createMessageNode({ ollama: capturingOllama, actionsConfig });
    await node(makeState("nudge_break", {
      userFeedback: [
        { text: "stop nagging me about water", userId: "u1", timestamp: "2026-04-12T10:15:00.000Z" },
      ],
    }));

    expect(capturedPrompt).toContain("stop nagging me about water");
    expect(capturedPrompt).toMatch(/user reply/i);
  });
});
