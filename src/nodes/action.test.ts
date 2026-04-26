import { expect, test } from "bun:test";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import { loadConfig } from "../config.ts";
import { createActionNode } from "./action.ts";

const config = loadConfig(`
actions:
  none:
    active: false
  nudge_break:
    active: true
    description: Suggest a short break
    fallback:
      body: Take a short break.
`);

test("action node includes 24-hour plan in prompt", async () => {
  const prompts: string[] = [];
  const ollama: OllamaAdapter = {
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ action: "nudge_break", reason: "aligned with plan" });
    },
    generateWithImage: async () => "",
  };

  const node = createActionNode({
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
    plan: {
      generatedAt: "2026-04-24T10:00:00.000Z",
      validUntil: "2026-04-25T10:00:00.000Z",
      items: [{ time: "10:30", action: "nudge_break", reason: "reset focus" }],
    },
  });

  expect(result.decision?.action).toBe("nudge_break");
  expect(prompts[0]).toContain("24-hour plan:");
  expect(prompts[0]).toContain("10:30: nudge_break (reset focus)");
});
