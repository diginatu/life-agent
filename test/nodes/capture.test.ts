import { test, expect, describe } from "bun:test";
import { createCaptureNode } from "../../src/nodes/capture.ts";
import { CaptureResultSchema } from "../../src/schemas/capture.ts";
import type { FfmpegAdapter } from "../../src/adapters/ffmpeg.ts";

function mockFfmpeg(success: boolean, stderr = ""): FfmpegAdapter {
  return {
    captureFrame: async () => ({ success, stderr }),
  };
}

describe("capture node", () => {
  const baseConfig = {
    webcamDevice: "/dev/video0",
    captureDir: "/tmp/captures",
    captureWidth: 640,
    captureHeight: 480,
  };

  test("returns valid CaptureResult on success", async () => {
    const node = createCaptureNode({
      ffmpeg: mockFfmpeg(true),
      config: baseConfig,
    });

    const result = await node({});
    expect(result.capture).toBeDefined();
    expect(CaptureResultSchema.safeParse(result.capture).success).toBe(true);
    expect(result.capture!.width).toBe(640);
    expect(result.capture!.height).toBe(480);
    expect(result.capture!.imagePath).toMatch(/^\/tmp\/captures\//);
  });

  test("capture imagePath contains ISO timestamp", async () => {
    const node = createCaptureNode({
      ffmpeg: mockFfmpeg(true),
      config: baseConfig,
    });

    const result = await node({});
    expect(result.capture!.imagePath).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("returns error and no capture on ffmpeg failure", async () => {
    const node = createCaptureNode({
      ffmpeg: mockFfmpeg(false, "device not found"),
      config: baseConfig,
    });

    const result = await node({});
    expect(result.capture).toBeUndefined();
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]).toContain("device not found");
  });
});
