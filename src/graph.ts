import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState } from "./state.ts";
import { createCaptureNode } from "./nodes/capture.ts";
import { createFfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { FfmpegAdapter } from "./adapters/ffmpeg.ts";
import type { Config } from "./config.ts";

interface GraphDeps {
  ffmpeg?: FfmpegAdapter;
}

export function buildGraph(config: Config, deps: GraphDeps = {}) {
  const ffmpeg = deps.ffmpeg ?? createFfmpegAdapter();

  const captureNode = createCaptureNode({
    ffmpeg,
    config: {
      webcamDevice: config.webcamDevice,
      captureDir: config.captureDir,
      captureWidth: config.captureWidth,
      captureHeight: config.captureHeight,
    },
  });

  return new StateGraph(GraphState)
    .addNode("capture_node", captureNode)
    .addEdge(START, "capture_node")
    .addEdge("capture_node", END)
    .compile();
}
