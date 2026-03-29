import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state.ts";
import { createCaptureNode } from "./nodes/capture.ts";
import { createSummarizeNode } from "./nodes/summarize.ts";
import { createFfmpegAdapter } from "./adapters/ffmpeg.ts";
import { createOllamaAdapterFromConfig } from "./adapters/ollama.ts";
import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { OllamaAdapter } from "./adapters/ollama.ts";
import type { Config } from "./config.ts";

interface GraphDeps {
  ffmpeg?: FfmpegAdapter;
  ollama?: OllamaAdapter;
  readFileBase64?: (path: string) => Promise<string>;
}

async function readFileBase64(path: string): Promise<string> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export function buildGraph(config: Config, deps: GraphDeps = {}) {
  const ffmpeg = deps.ffmpeg ?? createFfmpegAdapter();
  const ollama = deps.ollama ?? createOllamaAdapterFromConfig(config);

  const captureNode = createCaptureNode({
    ffmpeg,
    config: {
      webcamDevice: config.webcamDevice,
      captureDir: config.captureDir,
      captureWidth: config.captureWidth,
      captureHeight: config.captureHeight,
    },
  });

  const summarizeNode = createSummarizeNode({
    ollama,
    readFileBase64: deps.readFileBase64 ?? readFileBase64,
  });

  return new StateGraph(GraphState)
    .addNode("capture_node", captureNode)
    .addNode("summarize_node", summarizeNode)
    .addEdge(START, "capture_node")
    .addEdge("capture_node", "summarize_node")
    .addEdge("summarize_node", END)
    .compile();
}
