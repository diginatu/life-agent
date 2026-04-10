import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { OllamaAdapter } from "../adapters/ollama.ts";

export const PATTERNS_NAMESPACE = ["user", "patterns"];

interface MergeGroup {
  canonical: string;
  duplicates: string[];
  content: string;
  category: string;
}

interface MergePlan {
  merges: MergeGroup[];
}

interface PatternValue {
  content: string;
  category: string;
  observedCount: number;
  firstObserved: string;
  lastObserved: string;
}

export interface MergeOptions {
  minCountToRun?: number;
}

export interface MergeResult {
  merged: number;
}

export function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1]!.trim();
  return text.trim();
}

function parseMergePlan(raw: string): MergePlan {
  const parsed = JSON.parse(raw);
  const merges = Array.isArray(parsed.merges) ? parsed.merges : [];
  return {
    merges: merges.filter((g: unknown): g is MergeGroup => {
      if (!g || typeof g !== "object") return false;
      const o = g as Record<string, unknown>;
      return typeof o.canonical === "string"
        && Array.isArray(o.duplicates)
        && (o.duplicates as unknown[]).every((d) => typeof d === "string")
        && typeof o.content === "string"
        && typeof o.category === "string";
    }),
  };
}

function buildMergePrompt(
  patterns: Array<{ key: string; value: PatternValue }>,
): string {
  const lines = patterns.map((p) =>
    `- [${p.key}] (${p.value.category}, ${p.value.observedCount}x) ${p.value.content}`
  ).join("\n");

  return `You are cleaning up a behavioral pattern memory store. Many entries are near-duplicates with slightly different wording. Identify groups of patterns that describe the SAME underlying behavior and propose merges.

## Current Patterns
${lines}

## Instructions
- Group patterns that describe the same behavior (e.g. "late-night-bedroom-rest" and "late-night-posture-in-bedroom" both describe resting in bed at night).
- For each group, pick the clearest existing key as the canonical (or propose a new kebab-case key if none fit).
- Provide a single merged content sentence and category.
- Only merge patterns you are confident are truly duplicates. Leave distinct behaviors alone.
- Do NOT list a pattern in more than one group.
- If nothing needs merging, return {"merges": []}.

Return a JSON object (no markdown wrapping):
{
  "merges": [
    {"canonical": "key", "duplicates": ["key1", "key2"], "content": "Merged description", "category": "sleep|activity|routine|preference|wellness"}
  ]
}`;
}

function combineValues(values: PatternValue[], content: string, category: string): PatternValue {
  const observedCount = values.reduce((sum, v) => sum + (v.observedCount ?? 0), 0);
  const firstObserved = values
    .map((v) => v.firstObserved)
    .filter(Boolean)
    .sort()[0]!;
  const lastObserved = values
    .map((v) => v.lastObserved)
    .filter(Boolean)
    .sort()
    .slice(-1)[0]!;
  return { content, category, observedCount, firstObserved, lastObserved };
}

export async function mergeDuplicatePatterns(
  store: BaseStore,
  ollama: OllamaAdapter,
  options: MergeOptions = {},
): Promise<MergeResult> {
  const minCountToRun = options.minCountToRun ?? 30;

  const items = await store.search(PATTERNS_NAMESPACE, { limit: 200 });
  if (items.length < minCountToRun) {
    return { merged: 0 };
  }

  const patterns = items.map((item) => ({
    key: item.key,
    value: item.value as PatternValue,
  }));

  let plan: MergePlan;
  try {
    const response = await ollama.generate(buildMergePrompt(patterns));
    plan = parseMergePlan(extractJson(response));
  } catch {
    return { merged: 0 };
  }

  const byKey = new Map(patterns.map((p) => [p.key, p.value]));
  const seen = new Set<string>();
  let merged = 0;

  for (const group of plan.merges) {
    const uniqueDuplicates = group.duplicates.filter((k) => k !== group.canonical);
    if (uniqueDuplicates.length === 0) continue;

    const keysToCombine = [group.canonical, ...uniqueDuplicates];
    if (keysToCombine.some((k) => seen.has(k))) continue;

    const values: PatternValue[] = [];
    for (const k of keysToCombine) {
      const v = byKey.get(k);
      if (v) values.push(v);
    }
    if (values.length === 0) continue;

    const combined = combineValues(values, group.content, group.category);
    await store.put(PATTERNS_NAMESPACE, group.canonical, combined);

    for (const k of uniqueDuplicates) {
      if (byKey.has(k)) {
        await store.delete(PATTERNS_NAMESPACE, k);
        merged++;
      }
    }

    for (const k of keysToCombine) seen.add(k);
  }

  return { merged };
}
