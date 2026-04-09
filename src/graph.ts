import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseStore } from "@langchain/langgraph";
import { GraphState } from "./state.ts";
import { createCaptureNode } from "./nodes/capture.ts";
import { createSummarizeNode } from "./nodes/summarize.ts";
import { createActionNode } from "./nodes/action.ts";
import { createMessageNode } from "./nodes/message.ts";
import { createPersistNode } from "./nodes/persist.ts";
import { createExtractMemoriesNode } from "./nodes/extract-memories.ts";
import { createFfmpegAdapter } from "./adapters/ffmpeg.ts";
import { createOllamaAdapterFromConfig } from "./adapters/ollama.ts";
import { createFilesystemAdapter } from "./adapters/filesystem.ts";
import { createDiscordAdapter } from "./adapters/discord.ts";
import { FileStore } from "./store/file-store.ts";
import { seedActionDefinitions } from "./store/seed-actions.ts";
import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { OllamaAdapter } from "./adapters/ollama.ts";
import type { FilesystemAdapter } from "./adapters/filesystem.ts";
import type { DiscordAdapter } from "./adapters/discord.ts";
import type { Config } from "./config.ts";

interface GraphDeps {
  ffmpeg?: FfmpegAdapter;
  ollama?: OllamaAdapter;
  fs?: FilesystemAdapter;
  discord?: DiscordAdapter;
  store?: BaseStore;
  readFileBase64?: (path: string) => Promise<string>;
  now?: () => Date;
}

async function readFileBase64(path: string): Promise<string> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function buildGraph(config: Config, deps: GraphDeps = {}) {
  const s = config.settings;
  const ffmpeg = deps.ffmpeg ?? createFfmpegAdapter();
  const ollama = deps.ollama ?? createOllamaAdapterFromConfig(s);
  const fs = deps.fs ?? createFilesystemAdapter();
  let discord: DiscordAdapter | undefined = deps.discord;
  if (!discord && s.discordChannelId) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (token) {
      discord = await createDiscordAdapter(token, s.discordChannelId);
    } else {
      console.error("Discord enabled but DISCORD_BOT_TOKEN not set in environment");
    }
  }

  const captureNode = createCaptureNode({
    ffmpeg,
    config: {
      webcamDevice: s.webcamDevice,
      captureDir: s.captureDir,
      captureWidth: s.captureWidth,
      captureHeight: s.captureHeight,
    },
  });

  const summarizeNode = createSummarizeNode({
    ollama,
    readFileBase64: deps.readFileBase64 ?? readFileBase64,
  });

  const actionNode = createActionNode({ ollama, actionsConfig: config, fs, logDir: s.logDir, historyCount: s.actionHistoryCount, digestDays: s.actionDigestDays, now: deps.now });
  const messageNode = createMessageNode({ ollama, actionsConfig: config });
  const persistNode = createPersistNode({
    fs,
    config: { logDir: s.logDir },
    actionsConfig: config,
    discord,
  });
  const extractMemoriesNode = createExtractMemoriesNode({ ollama });

  const store = deps.store ?? await FileStore.create({ dir: s.memoryDir });
  await seedActionDefinitions(store, config);

  return new StateGraph(GraphState)
    .addNode("capture_node", captureNode)
    .addNode("summarize_node", summarizeNode)
    .addNode("action_node", actionNode)
    .addNode("message_node", messageNode)
    .addNode("persist_node", persistNode)
    .addNode("extract_memories_node", extractMemoriesNode)
    .addEdge(START, "capture_node")
    .addEdge("capture_node", "summarize_node")
    .addEdge("summarize_node", "action_node")
    .addEdge("action_node", "message_node")
    .addEdge("message_node", "persist_node")
    .addEdge("persist_node", "extract_memories_node")
    .addEdge("extract_memories_node", END)
    .compile({ store });
}
