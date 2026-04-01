import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

interface ExtractMemoriesNodeDeps {
  ollama: OllamaAdapter;
}

interface ExtractMemoriesNodeState {
  summary?: SceneSummary;
  decision?: ActionSelection;
}

interface ExtractMemoriesNodeResult {
  errors?: string[];
}

interface ExtractedPattern {
  key: string;
  content: string;
  category: string;
}

const MEMORY_NAMESPACE = ["user", "patterns"];

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildExtractionPrompt(
  summary: SceneSummary,
  decision: ActionSelection | undefined,
  existingMemories: Array<{ key: string; value: Record<string, unknown> }>,
): string {
  const memorySection = existingMemories.length > 0
    ? `## Existing Known Patterns\n${existingMemories.map((m) =>
      `- [${m.key}] ${m.value.content} (category: ${m.value.category}, observed ${m.value.observedCount} times)`
    ).join("\n")}`
    : "## Existing Known Patterns\nNone yet.";

  const observation = [
    `Person present: ${summary.personPresent}`,
    `Posture: ${summary.posture}`,
    `Scene: ${summary.scene}`,
    `Activity: ${summary.activityGuess ?? "unknown"}`,
    `Confidence: ${summary.confidence}`,
    `Time: ${new Date().toISOString()}`,
    decision ? `Action taken: ${decision.action} (${decision.reason})` : null,
  ].filter(Boolean).join("\n");

  return `You are a behavioral pattern analyzer. Given a current observation and existing known patterns, identify any new behavioral patterns or confirm existing ones.

${memorySection}

## Current Observation
${observation}

## Instructions
- Look for recurring behavioral patterns (sleep schedule, routines, habits, work patterns, wellness behaviors)
- If you see evidence of an EXISTING pattern (same key), include it to confirm the observation
- If you notice something NEW and noteworthy, add it with a descriptive key
- Use kebab-case keys (e.g., "sleep-late", "takes-bath-before-bed", "codes-at-night")
- Categories: "sleep", "activity", "routine", "preference", "wellness"
- Only include patterns you are reasonably confident about
- If nothing noteworthy, return an empty array

Return a JSON array (no markdown wrapping):
[{"key": "pattern-key", "content": "Description of the pattern", "category": "category"}]

If no patterns detected, return: []`;
}

export function createExtractMemoriesNode(deps: ExtractMemoriesNodeDeps) {
  return async (state: ExtractMemoriesNodeState, config: LangGraphRunnableConfig): Promise<ExtractMemoriesNodeResult> => {
    const store = config?.store;
    if (!store || !state.summary) {
      return {};
    }

    try {
      const existingItems = await store.search(MEMORY_NAMESPACE, { limit: 50 });
      const existingMemories = existingItems.map((item) => ({
        key: item.key,
        value: item.value,
      }));

      const prompt = buildExtractionPrompt(state.summary, state.decision, existingMemories);
      const response = await deps.ollama.generate(prompt);
      const jsonStr = extractJson(response);
      const patterns: ExtractedPattern[] = JSON.parse(jsonStr);

      if (!Array.isArray(patterns)) return {};

      const now = new Date().toISOString();

      for (const pattern of patterns) {
        if (!pattern.key || !pattern.content || !pattern.category) continue;

        const existing = await store.get(MEMORY_NAMESPACE, pattern.key);

        if (existing) {
          await store.put(MEMORY_NAMESPACE, pattern.key, {
            ...existing.value,
            content: pattern.content,
            category: pattern.category,
            observedCount: ((existing.value.observedCount as number) ?? 0) + 1,
            lastObserved: now,
          });
        } else {
          await store.put(MEMORY_NAMESPACE, pattern.key, {
            content: pattern.content,
            category: pattern.category,
            observedCount: 1,
            firstObserved: now,
            lastObserved: now,
          });
        }
      }
    } catch {
      // Best-effort: memory extraction should never break the pipeline
    }

    return {};
  };
}
