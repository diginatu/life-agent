export interface FfmpegAdapter {
  captureFrame(
    device: string,
    outputPath: string,
    width: number,
    height: number,
  ): Promise<{ success: boolean; stderr: string }>;
  listCaptures(dir: string): Promise<string[]>;
  deleteCapture(path: string): Promise<void>;
}

export type SpawnFn = typeof Bun.spawn;

export function createFfmpegAdapter(spawn: SpawnFn = Bun.spawn): FfmpegAdapter {
  return {
    async captureFrame(device, outputPath, width, height) {
      const args = [
        "ffmpeg",
        "-y",
        "-f",
        "v4l2",
        "-video_size",
        `${width}x${height}`,
        "-i",
        device,
        "-vf",
        "select='gte(t,3)',setpts=PTS-STARTPTS", // drop first 3s (camera warmup)
        "-frames:v",
        "1",
        outputPath,
      ];

      const proc = spawn(args, {
        stdout: "ignore",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderrText = await new Response(proc.stderr).text();

      return {
        success: exitCode === 0,
        stderr: stderrText,
      };
    },

    async listCaptures(dir) {
      const { readdir } = await import("node:fs/promises");
      try {
        const entries = await readdir(dir);
        return entries.filter((n) => n.startsWith("capture-") && n.endsWith(".jpg"));
      } catch {
        return [];
      }
    },

    async deleteCapture(path) {
      const { unlink } = await import("node:fs/promises");
      await unlink(path);
    },
  };
}
