import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { PATTERNS_NAMESPACE } from "./merge-patterns.ts";

export interface CapOptions {
  maxPatterns?: number;
}

export interface CapResult {
  evicted: number;
}

const DEFAULT_MAX_PATTERNS = 50;

export async function capUserPatterns(
  store: BaseStore,
  options: CapOptions = {},
): Promise<CapResult> {
  const maxPatterns = options.maxPatterns ?? DEFAULT_MAX_PATTERNS;

  const items = await store.search(PATTERNS_NAMESPACE, { limit: 500 });

  const ranked = items
    .map((item) => ({
      key: item.key,
      observedCount: (item.value.observedCount as number | undefined) ?? 0,
      lastObserved: (item.value.lastObserved as string | undefined) ?? "",
    }))
    .sort((a, b) => {
      if (b.observedCount !== a.observedCount) return b.observedCount - a.observedCount;
      return b.lastObserved.localeCompare(a.lastObserved);
    });

  const toEvict = ranked.slice(maxPatterns);

  for (const entry of toEvict) {
    await store.delete(PATTERNS_NAMESPACE, entry.key);
  }

  return { evicted: toEvict.length };
}
