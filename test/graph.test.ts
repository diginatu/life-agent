import { test, expect, describe } from "bun:test";
import { buildGraph } from "../src/graph.ts";
import { loadConfig } from "../src/config.ts";
import type { FfmpegAdapter } from "../src/adapters/ffmpeg.ts";

function mockFfmpeg(success: boolean, stderr = ""): FfmpegAdapter {
  return {
    captureFrame: async () => ({ success, stderr }),
  };
}

describe("buildGraph (capture only)", () => {
  const config = loadConfig();

  test("produces capture result with mocked ffmpeg", async () => {
    const graph = buildGraph(config, { ffmpeg: mockFfmpeg(true) });
    const result = await graph.invoke({});

    expect(result.capture).toBeDefined();
    expect(result.capture!.width).toBe(640);
    expect(result.capture!.height).toBe(480);
    expect(result.errors).toEqual([]);
  });

  test("produces error when ffmpeg fails", async () => {
    const graph = buildGraph(config, { ffmpeg: mockFfmpeg(false, "no camera") });
    const result = await graph.invoke({});

    expect(result.capture).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("no camera");
  });
});
