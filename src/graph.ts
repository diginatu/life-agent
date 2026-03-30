import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state.ts";
import { createCaptureNode } from "./nodes/capture.ts";
import { createSummarizeNode } from "./nodes/summarize.ts";
import { createPolicyNode } from "./nodes/policy.ts";
import { createActionNode } from "./nodes/action.ts";
import { createMessageNode } from "./nodes/message.ts";
import { createPersistNode } from "./nodes/persist.ts";
import { createFfmpegAdapter } from "./adapters/ffmpeg.ts";
import { createOllamaAdapterFromConfig } from "./adapters/ollama.ts";
import { createFilesystemAdapter } from "./adapters/filesystem.ts";
import { createNotifierAdapter } from "./adapters/notifier.ts";
import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { OllamaAdapter } from "./adapters/ollama.ts";
import type { FilesystemAdapter } from "./adapters/filesystem.ts";
import type { NotifierAdapter } from "./adapters/notifier.ts";
import type { Config } from "./config.ts";

interface GraphDeps {
  ffmpeg?: FfmpegAdapter;
  ollama?: OllamaAdapter;
  fs?: FilesystemAdapter;
  notifier?: NotifierAdapter;
  readFileBase64?: (path: string) => Promise<string>;
}

async function readFileBase64(path: string): Promise<string> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export function buildGraph(config: Config, deps: GraphDeps = {}) {
  const s = config.settings;
  const ffmpeg = deps.ffmpeg ?? createFfmpegAdapter();
  const ollama = deps.ollama ?? createOllamaAdapterFromConfig(s);
  const fs = deps.fs ?? createFilesystemAdapter();
  const notifier = deps.notifier ?? createNotifierAdapter();

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

  const policyNode = createPolicyNode({
    fs,
    config: {
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
      cooldownMinutes: s.cooldownMinutes,
      confidenceThreshold: s.confidenceThreshold,
      logDir: s.logDir,
    },
    actionsConfig: config,
  });

  const actionNode = createActionNode({ ollama, actionsConfig: config });
  const messageNode = createMessageNode({ ollama, actionsConfig: config });
  const persistNode = createPersistNode({
    fs,
    notifier,
    config: { logDir: s.logDir },
    actionsConfig: config,
  });

  return new StateGraph(GraphState)
    .addNode("capture_node", captureNode)
    .addNode("summarize_node", summarizeNode)
    .addNode("policy_node", policyNode)
    .addNode("action_node", actionNode)
    .addNode("message_node", messageNode)
    .addNode("persist_node", persistNode)
    .addEdge(START, "capture_node")
    .addEdge("capture_node", "summarize_node")
    .addEdge("summarize_node", "policy_node")
    .addEdge("policy_node", "action_node")
    .addEdge("action_node", "message_node")
    .addEdge("message_node", "persist_node")
    .addEdge("persist_node", END)
    .compile();
}
