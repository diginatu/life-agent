export interface FfmpegAdapter {
  captureFrame(
    device: string,
    outputPath: string,
    width: number,
    height: number,
  ): Promise<{ success: boolean; stderr: string }>;
}

export type SpawnFn = typeof Bun.spawn;

export function createFfmpegAdapter(spawn: SpawnFn = Bun.spawn): FfmpegAdapter {
  return {
    async captureFrame(device, outputPath, width, height) {
      const args = [
        "ffmpeg",
        "-y",
        "-f", "v4l2",
        "-video_size", `${width}x${height}`,
        "-i", device,
        "-vf", "select='gte(t,3)',setpts=PTS-STARTPTS",  // drop first 3s (camera warmup)
        "-frames:v", "1",
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
  };
}
