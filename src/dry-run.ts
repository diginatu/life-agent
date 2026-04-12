import { InMemoryStore } from "@langchain/langgraph";
import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { OllamaAdapter } from "./adapters/ollama.ts";
import type { FilesystemAdapter } from "./adapters/filesystem.ts";
import type { DiscordAdapter } from "./adapters/discord.ts";

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
  const extractMemoriesJson = "[]"; // no patterns extracted in dry-run
  const generateResponses = [actionJson, messageJson, extractMemoriesJson];

  const ffmpeg: FfmpegAdapter = {
    captureFrame: async (_device, outputPath) => {
      console.log(`[dry-run] Would capture frame to ${outputPath}`);
      return { success: true, stderr: "" };
    },
    listCaptures: async () => [],
    deleteCapture: async (path) => {
      console.log(`[dry-run] Would delete capture ${path}`);
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
    readLastNLinesAcrossDays: async () => [],
  };

  const discord: DiscordAdapter = {
    sendMessage: async (body, mentionUserId) => {
      const prefix = mentionUserId ? `<@${mentionUserId}> ` : "";
      console.log(`[dry-run] Would send Discord message: ${prefix}${body}`);
      return "dry-run-msg-id";
    },
    sendEmbed: async (title, body) => {
      console.log(`[dry-run] Would send Discord embed: "${title}" — ${body}`);
      return "dry-run-msg-id";
    },
    collectReplies: async () => [],
    getLatestMessageId: async () => null,
    destroy: async () => {},
  };

  const readFileBase64 = async () => "ZHJ5LXJ1bi1mYWtlLWltYWdl"; // "dry-run-fake-image" in base64

  const store = new InMemoryStore();

  return { ffmpeg, ollama, fs, discord, readFileBase64, store };
}
