import { test, expect, describe, mock, beforeEach } from "bun:test";
import { createFfmpegAdapter, type SpawnFn } from "../../src/adapters/ffmpeg.ts";

describe("FfmpegAdapter", () => {
  let mockSpawn: ReturnType<typeof mock>;

  function makeSpawn(exitCode: number, stderr: string): SpawnFn {
    mockSpawn = mock(() => ({
      exited: Promise.resolve(exitCode),
      stderr: new Response(stderr).body!,
    }));
    return mockSpawn as unknown as SpawnFn;
  }

  test("calls ffmpeg with correct arguments for v4l2 capture", async () => {
    const spawn = makeSpawn(0, "");
    const adapter = createFfmpegAdapter(spawn);

    await adapter.captureFrame("/dev/video0", "/tmp/out.jpg", 640, 480);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0]![0] as string[];
    expect(args[0]).toBe("ffmpeg");
    expect(args).toContain("-f");
    expect(args).toContain("v4l2");
    expect(args).toContain("-i");
    expect(args).toContain("/dev/video0");
    expect(args).toContain("-video_size");
    expect(args).toContain("640x480");
    expect(args).toContain("-vf");
    expect(args.find(a => a.includes("select"))).toBeDefined();
    expect(args).toContain("-frames:v");
    expect(args).toContain("1");
    // -video_size must come before -i (input option)
    expect(args.indexOf("-video_size")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.length - 1]).toBe("/tmp/out.jpg");
  });

  test("returns success when ffmpeg exits 0", async () => {
    const spawn = makeSpawn(0, "");
    const adapter = createFfmpegAdapter(spawn);

    const result = await adapter.captureFrame("/dev/video0", "/tmp/out.jpg", 640, 480);
    expect(result.success).toBe(true);
    expect(result.stderr).toBe("");
  });

  test("returns failure with stderr when ffmpeg exits non-zero", async () => {
    const spawn = makeSpawn(1, "v4l2: cannot open device");
    const adapter = createFfmpegAdapter(spawn);

    const result = await adapter.captureFrame("/dev/video0", "/tmp/out.jpg", 640, 480);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("cannot open device");
  });

  test("overwrites existing file with -y flag", async () => {
    const spawn = makeSpawn(0, "");
    const adapter = createFfmpegAdapter(spawn);

    await adapter.captureFrame("/dev/video0", "/tmp/out.jpg", 640, 480);

    const args = mockSpawn.mock.calls[0]![0] as string[];
    expect(args).toContain("-y");
  });
});
