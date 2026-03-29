import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { OllamaAdapter } from "./adapters/ollama.ts";
import type { FilesystemAdapter } from "./adapters/filesystem.ts";
import type { NotifierAdapter } from "./adapters/notifier.ts";

const summaryJson = JSON.stringify({
  personPresent: true,
  posture: "sitting",
  scene: "desk with monitor and keyboard",
  activityGuess: "coding",
  confidence: 0.85,
});

const actionJson = JSON.stringify({
  action: "nudge_break",
  priority: "low",
  reason: "user has been sitting at desk for a while",
});

const messageJson = JSON.stringify({
  title: "Time for a stretch!",
  body: "You've been coding for a while. Stand up and move around for a few minutes.",
});

export function createDryRunDeps() {
  let generateCallIndex = 0;
  const generateResponses = [actionJson, messageJson];

  const ffmpeg: FfmpegAdapter = {
    captureFrame: async (_device, outputPath) => {
      console.log(`[dry-run] Would capture frame to ${outputPath}`);
      return { success: true, stderr: "" };
    },
  };

  const ollama: OllamaAdapter = {
    generate: async () => generateResponses[generateCallIndex++] ?? actionJson,
    generateWithImage: async () => summaryJson,
  };

  const fs: FilesystemAdapter = {
    appendJsonLine: async (_dir, _date, data) => {
      console.log(`[dry-run] Would write log entry: ${JSON.stringify(data).slice(0, 100)}...`);
    },
    readLastNLines: async () => [],
  };

  const notifier: NotifierAdapter = {
    notify: async (title, body) => {
      console.log(`[dry-run] Would send notification: "${title}" — ${body}`);
    },
  };

  const readFileBase64 = async () => "ZHJ5LXJ1bi1mYWtlLWltYWdl"; // "dry-run-fake-image" in base64

  return { ffmpeg, ollama, fs, notifier, readFileBase64 };
}
