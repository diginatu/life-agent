import { test, expect, describe } from "bun:test";
import { buildGraph } from "../src/graph.ts";
import { loadConfig } from "../src/config.ts";
import type { FfmpegAdapter } from "../src/adapters/ffmpeg.ts";
import type { OllamaAdapter } from "../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../src/adapters/filesystem.ts";

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

function mockFs(lastEntries: unknown[] = []): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => lastEntries,
  };
}

const mockReadFile = async () => "fakebase64";

function allMocks(overrides: {
  ffmpegSuccess?: boolean;
  ffmpegStderr?: string;
  ollamaResponse?: string;
  ollamaError?: boolean;
  fsEntries?: unknown[];
} = {}) {
  return {
    ffmpeg: mockFfmpeg(overrides.ffmpegSuccess ?? true, overrides.ffmpegStderr),
    ollama: overrides.ollamaError ? errorOllama() : mockOllama(overrides.ollamaResponse),
    fs: mockFs(overrides.fsEntries ?? []),
    readFileBase64: mockReadFile,
  };
}

describe("buildGraph (capture + summarize + policy)", () => {
  const config = loadConfig();

  test("happy path: all nodes succeed, policy allows", async () => {
    const graph = buildGraph(config, allMocks());
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.policy).toBeDefined();
    expect(result.policy!.availableActions).toContain("nudge_break");
    expect(result.errors).toEqual([]);
  });

  test("ffmpeg failure: capture fails, policy restricts to none", async () => {
    const graph = buildGraph(config, allMocks({ ffmpegSuccess: false, ffmpegStderr: "no camera" }));
    const result = await graph.invoke({});

    expect(result.capture).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.policy).toBeDefined();
    expect(result.policy!.availableActions).toEqual(["none"]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("ollama failure: summarize fails, policy restricts to none", async () => {
    const graph = buildGraph(config, allMocks({ ollamaError: true }));
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeUndefined();
    expect(result.policy).toBeDefined();
    expect(result.policy!.availableActions).toEqual(["none"]);
    expect(result.errors.some((e: string) => e.includes("ollama"))).toBe(true);
  });

  test("policy restricts on duplicate scene", async () => {
    const lastEntry = {
      timestamp: new Date().toISOString(),
      decision: { action: "log_only" },
      summary: { scene: "desk with monitor", activityGuess: "coding" },
    };
    const graph = buildGraph(config, allMocks({ fsEntries: [lastEntry] }));
    const result = await graph.invoke({});

    expect(result.policy).toBeDefined();
    expect(result.policy!.availableActions).toEqual(["none", "log_only"]);
    expect(result.policy!.reasons.some((r: string) => r.includes("duplicate"))).toBe(true);
  });
});
