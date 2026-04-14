import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { mergeDuplicatePatterns, extractJson, PATTERNS_NAMESPACE } from "../store/merge-patterns.ts";
import { capUserPatterns } from "../store/cap-patterns.ts";
import { formatTime } from "./format-time.ts";
import {
  formatHistory,
  formatUserFeedback,
  type LogEntry,
  type UserFeedbackEntry,
} from "./history-format.ts";
import { z } from "zod/v4";
import { toJsonSchema } from "@langchain/core/utils/json_schema";

const ExtractMemoriesResponseSchema = z.object({
  patterns: z.array(z.object({ key: z.string(), content: z.string(), category: z.string() })),
});

const extractMemoriesJsonSchema = toJsonSchema(ExtractMemoriesResponseSchema) as Record<string, unknown>;

interface ExtractMemoriesNodeDeps {
  ollama: OllamaAdapter;
  mergeThreshold?: number;
  maxPatterns?: number;
  fs?: FilesystemAdapter;
  logDir?: string;
  historyCount?: number;
  now?: () => Date;
}

interface ExtractMemoriesNodeState {
  summary?: SceneSummary;
  decision?: ActionSelection;
  userFeedback?: UserFeedbackEntry[];
}

interface ExtractMemoriesNodeResult {
  errors?: string[];
}

function buildExtractionPrompt(
  summary: SceneSummary,
  decision: ActionSelection | undefined,
  existingMemories: Array<{ key: string; value: Record<string, unknown> }>,
  currentTime: Date,
  logEntries?: LogEntry[],
  userFeedback?: UserFeedbackEntry[],
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
    `Time: ${formatTime(currentTime)}`,
    decision ? `Action taken: ${decision.action} (${decision.reason})` : null,
  ].filter(Boolean).join("\n");

  const { history } = logEntries ? formatHistory(logEntries) : { history: "" };
  const historySection = history ? `\n## Recent History\n${history}\n` : "";
  const feedbackSection = formatUserFeedback(userFeedback);

  return `You are a behavioral pattern analyzer. Given a current observation, recent history, user feedback, and existing known patterns, identify any new behavioral patterns or confirm existing ones.

${memorySection}
## Current Observation
${observation}
${historySection}${feedbackSection}
## Instructions
- Look for recurring behavioral patterns (sleep schedule, routines, habits, work patterns, wellness behaviors)
- Use recent history to spot repetition across ticks and user replies to learn preferences
- If you see evidence of an EXISTING pattern (same key), include it to confirm the observation
- If you notice something NEW and noteworthy, add it with a descriptive key
- Use kebab-case keys (e.g., "sleep-late", "takes-bath-before-bed", "codes-at-night")
- Categories: "sleep", "activity", "routine", "preference", "wellness"
- Only include patterns you are reasonably confident about

Return a JSON object (no markdown wrapping):
{
  "patterns": [{"key": "pattern-key", "content": "Description of the pattern", "category": "category"}]
}

If nothing noteworthy: {"patterns": []}`;
}

export function createExtractMemoriesNode(deps: ExtractMemoriesNodeDeps) {
  return async (state: ExtractMemoriesNodeState, config: LangGraphRunnableConfig): Promise<ExtractMemoriesNodeResult> => {
    const store = config?.store;
    if (!store || !state.summary) {
      return {};
    }

    const now = deps.now ?? (() => new Date());
    const currentTime = now();

    const logEntriesPromise: Promise<LogEntry[] | undefined> = deps.fs && deps.logDir
      ? deps.fs
        .readLastNLines(deps.logDir, currentTime.toISOString().slice(0, 10), deps.historyCount ?? 10)
        .then((entries) => entries as LogEntry[])
        .catch(() => undefined)
      : Promise.resolve(undefined);

    try {
      const [existingItems, logEntries] = await Promise.all([
        store.search(PATTERNS_NAMESPACE, { limit: 50 }),
        logEntriesPromise,
      ]);

      const existingMemories = existingItems.map((item) => ({
        key: item.key,
        value: item.value,
      }));

      const prompt = buildExtractionPrompt(
        state.summary,
        state.decision,
        existingMemories,
        currentTime,
        logEntries,
        state.userFeedback,
      );
      const response = await deps.ollama.generate(prompt, { format: extractMemoriesJsonSchema });
      const parsed = ExtractMemoriesResponseSchema.parse(JSON.parse(extractJson(response)));
      const { patterns } = parsed;

      const now = new Date().toISOString();

      for (const pattern of patterns) {
        if (!pattern.key || !pattern.content || !pattern.category) continue;

        const existing = await store.get(PATTERNS_NAMESPACE, pattern.key);

        if (existing) {
          await store.put(PATTERNS_NAMESPACE, pattern.key, {
            ...existing.value,
            content: pattern.content,
            category: pattern.category,
            observedCount: ((existing.value.observedCount as number) ?? 0) + 1,
            lastObserved: now,
          });
        } else {
          await store.put(PATTERNS_NAMESPACE, pattern.key, {
            content: pattern.content,
            category: pattern.category,
            observedCount: 1,
            firstObserved: now,
            lastObserved: now,
          });
        }
      }

      await mergeDuplicatePatterns(store, deps.ollama, { minCountToRun: deps.mergeThreshold });
      await capUserPatterns(store, { maxPatterns: deps.maxPatterns });
    } catch {
      // best-effort
    }

    return {};
  };
}
