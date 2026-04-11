import { test, expect, describe } from "bun:test";
import { createCaptureNode } from "../../src/nodes/capture.ts";
import { CaptureResultSchema } from "../../src/schemas/capture.ts";
import type { FfmpegAdapter } from "../../src/adapters/ffmpeg.ts";

function mockFfmpeg(success: boolean, stderr = ""): FfmpegAdapter {
  return {
    captureFrame: async () => ({ success, stderr }),
    listCaptures: async () => [],
    deleteCapture: async () => {},
  };
}

describe("capture node", () => {
  const baseConfig = {
    webcamDevice: "/dev/video0",
    captureDir: "/tmp/captures",
    captureWidth: 640,
    captureHeight: 480,
    captureRetentionCount: 10,
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

  describe("retention pruning", () => {
    function trackingFfmpeg(existing: string[]) {
      const deleted: string[] = [];
      const ffmpeg: FfmpegAdapter = {
        captureFrame: async () => ({ success: true, stderr: "" }),
        listCaptures: async () => existing,
        deleteCapture: async (path: string) => {
          deleted.push(path);
        },
      };
      return { ffmpeg, deleted };
    }

    test("deletes oldest captures beyond retention count", async () => {
      // 12 lexically-sortable ISO-ish capture names; retention 10 → delete 2 oldest
      const names = Array.from({ length: 12 }, (_, i) =>
        `capture-2026-04-11T10-${String(i).padStart(2, "0")}-00.000Z.jpg`,
      );
      const { ffmpeg, deleted } = trackingFfmpeg([...names]);
      const node = createCaptureNode({
        ffmpeg,
        config: { ...baseConfig, captureRetentionCount: 10 },
      });

      await node({});

      expect(deleted.length).toBe(2);
      expect(deleted).toContain("/tmp/captures/" + names[0]);
      expect(deleted).toContain("/tmp/captures/" + names[1]);
    });

    test("no-op when file count is at or below retention", async () => {
      const names = Array.from({ length: 10 }, (_, i) =>
        `capture-2026-04-11T10-${String(i).padStart(2, "0")}-00.000Z.jpg`,
      );
      const { ffmpeg, deleted } = trackingFfmpeg(names);
      const node = createCaptureNode({
        ffmpeg,
        config: { ...baseConfig, captureRetentionCount: 10 },
      });

      await node({});
      expect(deleted.length).toBe(0);
    });

    test("capture still succeeds when prune deletion throws", async () => {
      const names = Array.from({ length: 12 }, (_, i) =>
        `capture-2026-04-11T10-${String(i).padStart(2, "0")}-00.000Z.jpg`,
      );
      const ffmpeg: FfmpegAdapter = {
        captureFrame: async () => ({ success: true, stderr: "" }),
        listCaptures: async () => names,
        deleteCapture: async () => {
          throw new Error("permission denied");
        },
      };
      const node = createCaptureNode({
        ffmpeg,
        config: { ...baseConfig, captureRetentionCount: 10 },
      });

      const result = await node({});
      expect(result.capture).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    test("does not prune when ffmpeg capture fails", async () => {
      const names = Array.from({ length: 12 }, (_, i) =>
        `capture-2026-04-11T10-${String(i).padStart(2, "0")}-00.000Z.jpg`,
      );
      const deleted: string[] = [];
      const ffmpeg: FfmpegAdapter = {
        captureFrame: async () => ({ success: false, stderr: "boom" }),
        listCaptures: async () => names,
        deleteCapture: async (path: string) => {
          deleted.push(path);
        },
      };
      const node = createCaptureNode({
        ffmpeg,
        config: { ...baseConfig, captureRetentionCount: 10 },
      });

      await node({});
      expect(deleted.length).toBe(0);
    });
  });
});
