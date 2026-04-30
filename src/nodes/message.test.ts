import { expect, test } from "bun:test";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import { loadConfig } from "../config.ts";
import { createMessageNode } from "./message.ts";

const config = loadConfig(`
actions:
  none:
    active: false
  nudge_break:
    active: true
    description: Suggest a short break
    fallback:
      body: Take a short break.
  replan-next:
    active: false
    description: Refresh plan on next cycle
`);

test("message node includes 24-hour plan in prompt", async () => {
  const prompts: string[] = [];
  const ollama: OllamaAdapter = {
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ body: "Take a short break now." });
    },
    generateWithImage: async () => "",
  };

  const node = createMessageNode({
    ollama,
    actionsConfig: config,
    now: () => new Date("2026-04-24T10:00:00.000Z"),
  });

  const result = await node({
    summary: {
      personPresent: true,
      posture: "sitting",
      scene: "desk",
      activityGuess: "coding",
      confidence: 0.8,
    },
    decision: { actions: ["nudge_break", "nudge_sleep"], reason: "aligned with plan" },
    plan: {
      generatedAt: "2026-04-24T10:00:00.000Z",
      validUntil: "2026-04-25T10:00:00.000Z",
      items: [{ time: "10:30", action: "nudge_break", reason: "reset focus" }],
    },
  });

  expect(result.message?.body).toBe("Take a short break now.");
  expect(prompts[0]).toContain("24-hour plan:");
  expect(prompts[0]).toContain("10:30: nudge_break (reset focus)");
  expect(prompts[0]).toContain("Actions: nudge_break, nudge_sleep");
});

test("message node excludes replan-next from prompt action list", async () => {
  const prompts: string[] = [];
  const ollama: OllamaAdapter = {
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ body: "Take a short break now." });
    },
    generateWithImage: async () => "",
  };

  const node = createMessageNode({
    ollama,
    actionsConfig: config,
    now: () => new Date("2026-04-24T10:00:00.000Z"),
  });

  const result = await node({
    summary: {
      personPresent: true,
      posture: "sitting",
      scene: "desk",
      activityGuess: "coding",
      confidence: 0.8,
    },
    decision: { actions: ["nudge_break", "replan-next"], reason: "fresh feedback" },
  });

  expect(result.message?.body).toBe("Take a short break now.");
  expect(prompts[0]).toContain("Actions: nudge_break");
  expect(prompts[0]).not.toContain("Actions: nudge_break, replan-next");
  expect(prompts[0]).not.toContain("- replan-next:");
});

test("message node returns null when only replan-next is selected", async () => {
  const ollama: OllamaAdapter = {
    generate: async () => JSON.stringify({ body: "unused" }),
    generateWithImage: async () => "",
  };

  const node = createMessageNode({
    ollama,
    actionsConfig: config,
    now: () => new Date("2026-04-24T10:00:00.000Z"),
  });

  const result = await node({
    summary: {
      personPresent: true,
      posture: "sitting",
      scene: "desk",
      activityGuess: "coding",
      confidence: 0.8,
    },
    decision: { actions: ["replan-next"], reason: "fresh feedback" },
  });

  expect(result.message).toBeNull();
});
