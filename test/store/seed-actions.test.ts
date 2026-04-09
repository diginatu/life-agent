import { describe, test, expect } from "bun:test";
import { InMemoryStore } from "@langchain/langgraph";
import { seedActionDefinitions } from "../../src/store/seed-actions.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const ACTION_DEFS_NS = ["actions", "definitions"];

describe("seedActionDefinitions", () => {
  test("seeds descriptions from config into empty store", async () => {
    const store = new InMemoryStore();
    const config = mockActionsConfig();

    await seedActionDefinitions(store, config);

    const nudgeBreak = await store.get(ACTION_DEFS_NS, "nudge_break");
    expect(nudgeBreak).not.toBeNull();
    expect(nudgeBreak!.value.description).toBe("Suggest the user take a short break");
    expect(nudgeBreak!.value.source).toBe("seed");
    expect(nudgeBreak!.value.updatedAt).toBeDefined();

    const nudgeSleep = await store.get(ACTION_DEFS_NS, "nudge_sleep");
    expect(nudgeSleep).not.toBeNull();
    expect(nudgeSleep!.value.description).toBe("Suggest the user go to sleep");
  });

  test("skips actions without descriptions", async () => {
    const store = new InMemoryStore();
    const config = mockActionsConfig();

    await seedActionDefinitions(store, config);

    const none = await store.get(ACTION_DEFS_NS, "none");
    expect(none).toBeNull();

    const logOnly = await store.get(ACTION_DEFS_NS, "log_only");
    expect(logOnly).toBeNull();
  });

  test("does not overwrite existing entries", async () => {
    const store = new InMemoryStore();
    // Pre-populate with a learned definition
    await store.put(ACTION_DEFS_NS, "nudge_break", {
      description: "Learned: suggest break after 2h coding",
      source: "learned",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const config = mockActionsConfig();
    await seedActionDefinitions(store, config);

    const nudgeBreak = await store.get(ACTION_DEFS_NS, "nudge_break");
    expect(nudgeBreak!.value.description).toBe("Learned: suggest break after 2h coding");
    expect(nudgeBreak!.value.source).toBe("learned");
  });
});
