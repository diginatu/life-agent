import { test, expect, describe } from "bun:test";
import { buildGraph } from "../src/graph.ts";
import { loadConfig } from "../src/config.ts";
import type { FfmpegAdapter } from "../src/adapters/ffmpeg.ts";
import type { OllamaAdapter } from "../src/adapters/ollama.ts";

function mockFfmpeg(success: boolean, stderr = ""): FfmpegAdapter {
  return {
    captureFrame: async () => ({ success, stderr }),
  };
}

const validSummaryJson = JSON.stringify({
  personPresent: true,
  posture: "sitting",
  scene: "desk with monitor",
  activityGuess: "coding",
  confidence: 0.85,
});

function mockOllama(response = validSummaryJson): OllamaAdapter {
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

const mockReadFile = async () => "fakebase64";

describe("buildGraph (capture + summarize)", () => {
  const config = loadConfig();

  test("happy path: capture + summarize both succeed", async () => {
    const graph = buildGraph(config, {
      ffmpeg: mockFfmpeg(true),
      ollama: mockOllama(),
      readFileBase64: mockReadFile,
    });
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary!.personPresent).toBe(true);
    expect(result.summary!.confidence).toBe(0.85);
    expect(result.errors).toEqual([]);
  });

  test("ffmpeg failure: no capture, summarize gets error", async () => {
    const graph = buildGraph(config, {
      ffmpeg: mockFfmpeg(false, "no camera"),
      ollama: mockOllama(),
      readFileBase64: mockReadFile,
    });
    const result = await graph.invoke({});

    expect(result.capture).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("ollama failure: capture succeeds, summarize fails gracefully", async () => {
    const graph = buildGraph(config, {
      ffmpeg: mockFfmpeg(true),
      ollama: errorOllama(),
      readFileBase64: mockReadFile,
    });
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e: string) => e.includes("ollama"))).toBe(true);
  });
});
