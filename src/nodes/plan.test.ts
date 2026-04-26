import { InMemoryStore } from "@langchain/langgraph";
import { expect, test } from "bun:test";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import { loadConfig } from "../config.ts";
import { PlanSchema, type Plan } from "../schemas/plan.ts";
import { createPlanNode } from "./plan.ts";

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

const summary = {
  personPresent: true,
  posture: "sitting",
  scene: "desk",
  activityGuess: "coding",
  confidence: 0.8,
};

function createOllamaMock(response: string, calls: string[]): OllamaAdapter {
  return {
    generate: async (prompt: string) => {
      calls.push(prompt);
      return response;
    },
    generateWithImage: async () => "",
  };
}

test("plan node generates and stores a plan when no cache exists", async () => {
  const calls: string[] = [];
  const store = new InMemoryStore();
  const now = new Date("2026-04-24T10:00:00.000Z");
  const node = createPlanNode({
    ollama: createOllamaMock(
      JSON.stringify({
        items: [{ time: "10:30", action: "nudge_break", reason: "reset focus" }],
      }),
      calls,
    ),
    actionsConfig: config,
    store,
    now: () => now,
  });

  const result = await node({ summary });

  expect(calls.length).toBe(1);
  expect(result.errors).toBeUndefined();
  expect(result.plan).toBeDefined();
  expect(result.plan?.generatedAt).toBe("2026-04-24T10:00:00.000Z");
  expect(result.plan?.validUntil).toBe("2026-04-25T10:00:00.000Z");

  const stored = await store.get(["memory", "plan"], "current");
  const parsedStored = PlanSchema.parse(stored?.value);
  expect(parsedStored.validUntil).toBe("2026-04-25T10:00:00.000Z");
});

test("plan node reuses cached plan within 24 hours without calling ollama", async () => {
  const calls: string[] = [];
  const store = new InMemoryStore();
  const cachedPlan: Plan = {
    generatedAt: "2026-04-24T09:00:00.000Z",
    validUntil: "2026-04-25T09:00:00.000Z",
    items: [{ time: "11:00", action: "nudge_break", reason: "scheduled break" }],
  };
  await store.put(["memory", "plan"], "current", cachedPlan);

  const node = createPlanNode({
    ollama: createOllamaMock(JSON.stringify({ items: [] }), calls),
    actionsConfig: config,
    store,
    now: () => new Date("2026-04-24T20:00:00.000Z"),
  });

  const result = await node({});

  expect(calls.length).toBe(0);
  expect(result.errors).toBeUndefined();
  expect(result.plan).toEqual(cachedPlan);
});

test("plan node regenerates after expiry", async () => {
  const calls: string[] = [];
  const store = new InMemoryStore();
  await store.put(["memory", "plan"], "current", {
    generatedAt: "2026-04-23T08:00:00.000Z",
    validUntil: "2026-04-24T08:00:00.000Z",
    items: [{ time: "08:30", action: "nudge_break", reason: "old plan" }],
  } satisfies Plan);

  const node = createPlanNode({
    ollama: createOllamaMock(
      JSON.stringify({
        items: [{ time: "12:00", action: "nudge_break", reason: "new cycle" }],
      }),
      calls,
    ),
    actionsConfig: config,
    store,
    now: () => new Date("2026-04-24T10:00:00.000Z"),
  });

  const result = await node({ summary });

  expect(calls.length).toBe(1);
  expect(result.plan?.items[0]?.reason).toBe("new cycle");
  expect(result.plan?.validUntil).toBe("2026-04-25T10:00:00.000Z");
});

test("plan node returns stale cache when regeneration fails", async () => {
  const calls: string[] = [];
  const store = new InMemoryStore();
  const stale: Plan = {
    generatedAt: "2026-04-23T08:00:00.000Z",
    validUntil: "2026-04-24T08:00:00.000Z",
    items: [{ time: "08:30", action: "nudge_break", reason: "stale" }],
  };
  await store.put(["memory", "plan"], "current", stale);

  const node = createPlanNode({
    ollama: createOllamaMock("not-json", calls),
    actionsConfig: config,
    store,
    now: () => new Date("2026-04-24T10:00:00.000Z"),
  });

  const result = await node({ summary });

  expect(calls.length).toBe(1);
  expect(result.plan).toEqual(stale);
  expect(result.errors?.[0]).toContain("plan: failed to parse JSON");

  const stored = await store.get(["memory", "plan"], "current");
  expect(PlanSchema.parse(stored?.value)).toEqual(stale);
});
