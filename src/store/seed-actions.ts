import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { Config } from "../config.ts";

export const ACTION_DEFS_NAMESPACE = ["actions", "definitions"];

export interface ActionDefinitionRecord {
  description: string;
  source: "seed" | "learned";
  updatedAt: string;
}

export async function seedActionDefinitions(store: BaseStore, config: Config): Promise<void> {
  for (const name of config.getActionNames()) {
    const description = config.getDescription(name);
    if (!description) continue;

    const existing = await store.get(ACTION_DEFS_NAMESPACE, name);
    if (existing) continue;

    const record: ActionDefinitionRecord = {
      description,
      source: "seed",
      updatedAt: new Date().toISOString(),
    };
    await store.put(ACTION_DEFS_NAMESPACE, name, record);
  }
}
