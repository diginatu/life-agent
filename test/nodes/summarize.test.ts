import { test, expect, describe } from "bun:test";
import { createSummarizeNode } from "../../src/nodes/summarize.ts";
import { SceneSummarySchema } from "../../src/schemas/summary.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";

function mockOllama(response: string): OllamaAdapter {
  return {
    generate: async () => response,
    generateWithImage: async () => response,
  };
}

function errorOllama(error: Error): OllamaAdapter {
  return {
    generate: async () => { throw error; },
    generateWithImage: async () => { throw error; },
  };
}

const validSummaryJson = JSON.stringify({
  personPresent: true,
  posture: "sitting",
  scene: "desk with monitor and keyboard",
  activityGuess: "coding",
  confidence: 0.85,
});

const captureState = {
  capture: {
    imagePath: "/tmp/test.jpg",
    timestamp: "2026-03-29T12:00:00.000Z",
    width: 640,
    height: 480,
  },
};

describe("summarize node", () => {
  test("returns valid SceneSummary on success", async () => {
    const node = createSummarizeNode({
      ollama: mockOllama(validSummaryJson),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(SceneSummarySchema.safeParse(result.summary).success).toBe(true);
    expect(result.summary!.personPresent).toBe(true);
    expect(result.summary!.confidence).toBe(0.85);
  });

  test("handles JSON wrapped in markdown code block", async () => {
    const wrappedResponse = "```json\n" + validSummaryJson + "\n```";
    const node = createSummarizeNode({
      ollama: mockOllama(wrappedResponse),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(result.summary!.personPresent).toBe(true);
  });

  test("returns error when Ollama fails", async () => {
    const node = createSummarizeNode({
      ollama: errorOllama(new Error("connection refused")),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("connection refused");
  });

  test("returns error when Ollama returns invalid JSON", async () => {
    const node = createSummarizeNode({
      ollama: mockOllama("I see a person sitting at a desk"),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("parse");
  });

  test("returns error when Ollama returns JSON that fails schema validation", async () => {
    const badJson = JSON.stringify({ personPresent: "yes", confidence: 2 });
    const node = createSummarizeNode({
      ollama: mockOllama(badJson),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("skips when no capture in state", async () => {
    const node = createSummarizeNode({
      ollama: mockOllama(validSummaryJson),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node({});
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("no capture");
  });
});
