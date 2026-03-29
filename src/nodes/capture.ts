import type { FfmpegAdapter } from "../adapters/ffmpeg.ts";
import type { CaptureResult } from "../schemas/capture.ts";

interface CaptureConfig {
  webcamDevice: string;
  captureDir: string;
  captureWidth: number;
  captureHeight: number;
}

interface CaptureNodeDeps {
  ffmpeg: FfmpegAdapter;
  config: CaptureConfig;
}

interface CaptureNodeResult {
  capture?: CaptureResult;
  errors?: string[];
}

export function createCaptureNode(deps: CaptureNodeDeps) {
  return async (_state: Record<string, unknown>): Promise<CaptureNodeResult> => {
    const { ffmpeg, config } = deps;
    const timestamp = new Date().toISOString();
    const safeTimestamp = timestamp.replace(/:/g, "-");
    const imagePath = `${config.captureDir}/capture-${safeTimestamp}.jpg`;

    const result = await ffmpeg.captureFrame(
      config.webcamDevice,
      imagePath,
      config.captureWidth,
      config.captureHeight,
    );

    if (!result.success) {
      const errorMsg = `ffmpeg capture failed: ${result.stderr}`;
      console.error(errorMsg);
      return { errors: [errorMsg] };
    }

    return {
      capture: {
        imagePath,
        timestamp,
        width: config.captureWidth,
        height: config.captureHeight,
      },
    };
  };
}
