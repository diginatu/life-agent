import { test, expect, describe } from "bun:test";
import { summarizeLayer } from "../../src/memory/summarize-layer.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { LogEntry } from "../../src/nodes/history-format.ts";

const sampleEntries: LogEntry[] = [
  {
    timestamp: "2026-04-15T10:00:00.000Z",
    summary: { activityGuess: "coding", posture: "sitting" },
    decision: { action: "none", reason: "routine" },
  },
  {
    timestamp: "2026-04-15T10:15:00.000Z",
    summary: { activityGuess: "reading", posture: "sitting" },
    decision: { action: "nudge_break", reason: "long session" },
  },
];

describe("summarizeLayer", () => {
  test("returns LLM output string", async () => {
    const ollama: OllamaAdapter = { generate: async () => "the summary", generateWithImage: async () => "" };
    const result = await summarizeLayer(ollama, sampleEntries, "2026-04-15T10");
    expect(result).toBe("the summary");
  });

  test("prompt contains window label", async () => {
    let captured = "";
    const ollama: OllamaAdapter = { generate: async (p) => { captured = p; return "x"; }, generateWithImage: async () => "" };
    await summarizeLayer(ollama, sampleEntries, "2026-04-15T10");
    expect(captured).toContain("2026-04-15T10");
  });

  test("prompt contains entry activity", async () => {
    let captured = "";
    const ollama: OllamaAdapter = { generate: async (p) => { captured = p; return "x"; }, generateWithImage: async () => "" };
    await summarizeLayer(ollama, sampleEntries, "2026-04-15T10");
    expect(captured).toContain("coding");
  });

  test("prompt contains entry action", async () => {
    let captured = "";
    const ollama: OllamaAdapter = { generate: async (p) => { captured = p; return "x"; }, generateWithImage: async () => "" };
    await summarizeLayer(ollama, sampleEntries, "2026-04-15T10");
    expect(captured).toContain("nudge_break");
  });
});
