import { test, expect, describe } from "bun:test";
import { buildGraph } from "../src/graph.ts";
import type { FfmpegAdapter } from "../src/adapters/ffmpeg.ts";
import type { OllamaAdapter } from "../src/adapters/ollama.ts";
import type { FilesystemAdapter } from "../src/adapters/filesystem.ts";
import { mockActionsConfig } from "./helpers/mock-config.ts";

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

const validActionJson = JSON.stringify({
  action: "nudge_break",
  priority: "low",
  reason: "user has been sitting for a while",
});

const validMessageJson = JSON.stringify({
  title: "Time for a break!",
  body: "You've been coding for a while. Stand up and stretch.",
});

// generate() is called by action node first, then message node
// Return action JSON on first call, message JSON on second
function mockOllama(overrides?: {
  generateResponses?: string[];
  generateWithImage?: string;
  error?: boolean;
}): OllamaAdapter {
  if (overrides?.error) {
    return {
      generate: async () => { throw new Error("ollama down"); },
      generateWithImage: async () => { throw new Error("ollama down"); },
    };
  }
  let callIndex = 0;
  const responses = overrides?.generateResponses ?? [validActionJson, validMessageJson];
  return {
    generate: async () => responses[callIndex++] ?? validActionJson,
    generateWithImage: async () => overrides?.generateWithImage ?? validSummaryJson,
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
  ollamaGenerateResponses?: string[];
  ollamaGenerateWithImage?: string;
  ollamaError?: boolean;
  fsEntries?: unknown[];
} = {}) {
  return {
    ffmpeg: mockFfmpeg(overrides.ffmpegSuccess ?? true, overrides.ffmpegStderr),
    ollama: mockOllama({
      generateResponses: overrides.ollamaGenerateResponses,
      generateWithImage: overrides.ollamaGenerateWithImage,
      error: overrides.ollamaError,
    }),
    fs: mockFs(overrides.fsEntries ?? []),
    readFileBase64: mockReadFile,
    now: () => new Date("2026-03-29T14:00:00"),
  };
}

describe("buildGraph (full pipeline)", () => {
  const config = mockActionsConfig();

  test("happy path: all 6 nodes succeed, nudge with message", async () => {
    const graph = await buildGraph(config, allMocks());
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(result.decision!.action).toBe("nudge_break");
    expect(result.message).toBeDefined();
    expect(result.message!.title).toBe("Time for a break!");
    expect(result.errors).toEqual([]);
  });

  test("ffmpeg failure: degrades gracefully through all nodes", async () => {
    const graph = await buildGraph(config, allMocks({ ffmpegSuccess: false, ffmpegStderr: "no camera" }));
    const result = await graph.invoke({});

    expect(result.capture).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.decision!.action).toBe("log_only");
    expect(result.message).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("ollama failure: degrades gracefully through all nodes", async () => {
    const graph = await buildGraph(config, allMocks({ ollamaError: true }));
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.summary).toBeUndefined();
    expect(result.decision!.action).toBe("log_only");
    expect(result.message).toBeNull();
    expect(result.errors.some((e: string) => e.includes("ollama"))).toBe(true);
  });

  test("log_only action: no message drafted, no notification", async () => {
    const logOnlyAction = JSON.stringify({
      action: "log_only",
      priority: "low",
      reason: "routine check",
    });
    const graph = await buildGraph(config, allMocks({ ollamaGenerateResponses: [logOnlyAction] }));
    const result = await graph.invoke({});

    expect(result.decision!.action).toBe("log_only");
    expect(result.message).toBeNull();
  });
});
