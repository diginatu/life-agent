import { test, expect, describe } from "bun:test";
import { createSummarizeNode } from "../../src/nodes/summarize.ts";
import { SceneSummarySchema } from "../../src/schemas/summary.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";

interface OllamaCall {
  prompt: string;
  image: string | string[];
}

function recordingOllama(response: string): { ollama: OllamaAdapter; calls: OllamaCall[] } {
  const calls: OllamaCall[] = [];
  return {
    calls,
    ollama: {
      generate: async () => response,
      generateWithImage: async (prompt, image) => {
        calls.push({ prompt, image });
        return response;
      },
    },
  };
}

function mockOllama(response: string): OllamaAdapter {
  return recordingOllama(response).ollama;
}

function errorOllama(error: Error): OllamaAdapter {
  return {
    generate: async () => { throw error; },
    generateWithImage: async () => { throw error; },
  };
}

function emptyFs(): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => [],
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

const baseDeps = {
  fs: emptyFs(),
  logDir: "/tmp/logs",
  now: () => new Date("2026-03-29T12:00:00.000Z"),
  fileExists: async () => true,
};

describe("summarize node", () => {
  test("returns valid SceneSummary on success", async () => {
    const node = createSummarizeNode({
      ...baseDeps,
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
      ...baseDeps,
      ollama: mockOllama(wrappedResponse),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(result.summary!.personPresent).toBe(true);
  });

  test("returns error when Ollama fails", async () => {
    const node = createSummarizeNode({
      ...baseDeps,
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
      ...baseDeps,
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
      ...baseDeps,
      ollama: mockOllama(badJson),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node(captureState);
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  test("skips when no capture in state", async () => {
    const node = createSummarizeNode({
      ...baseDeps,
      ollama: mockOllama(validSummaryJson),
      readFileBase64: async () => "fakebase64data",
    });

    const result = await node({});
    expect(result.summary).toBeUndefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("no capture");
  });

  test("passes both previous and current images when previous log entry exists", async () => {
    const rec = recordingOllama(validSummaryJson);
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        { capture: { imagePath: "/tmp/prev.jpg" } },
      ],
    };
    const node = createSummarizeNode({
      ...baseDeps,
      fs,
      ollama: rec.ollama,
      readFileBase64: async (p) => `b64:${p}`,
      fileExists: async () => true,
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(rec.calls).toHaveLength(1);
    const image = rec.calls[0]!.image;
    expect(Array.isArray(image)).toBe(true);
    expect(image).toEqual(["b64:/tmp/prev.jpg", "b64:/tmp/test.jpg"]);
    expect(rec.calls[0]!.prompt).toContain("TWO webcam images");
  });

  test("passes single image when no previous log entry exists", async () => {
    const rec = recordingOllama(validSummaryJson);
    const node = createSummarizeNode({
      ...baseDeps,
      ollama: rec.ollama,
      readFileBase64: async (p) => `b64:${p}`,
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(rec.calls).toHaveLength(1);
    const image = rec.calls[0]!.image;
    expect(image).toEqual(["b64:/tmp/test.jpg"]);
    expect(rec.calls[0]!.prompt).not.toContain("TWO webcam images");
  });

  test("falls back to single image when previous capture file was pruned", async () => {
    const rec = recordingOllama(validSummaryJson);
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        { capture: { imagePath: "/tmp/gone.jpg" } },
      ],
    };
    const node = createSummarizeNode({
      ...baseDeps,
      fs,
      ollama: rec.ollama,
      readFileBase64: async (p) => `b64:${p}`,
      fileExists: async () => false,
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(rec.calls[0]!.image).toEqual(["b64:/tmp/test.jpg"]);
  });

  test("falls back to single image when readLastNLines throws", async () => {
    const rec = recordingOllama(validSummaryJson);
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => { throw new Error("disk error"); },
    };
    const node = createSummarizeNode({
      ...baseDeps,
      fs,
      ollama: rec.ollama,
      readFileBase64: async (p) => `b64:${p}`,
    });

    const result = await node(captureState);
    expect(result.summary).toBeDefined();
    expect(result.errors).toBeUndefined();
    expect(rec.calls[0]!.image).toEqual(["b64:/tmp/test.jpg"]);
  });
});
