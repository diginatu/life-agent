import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ACTION_DEFS_NAMESPACE, type ActionDefinitionRecord } from "../store/seed-actions.ts";
import { mergeDuplicatePatterns, extractJson, PATTERNS_NAMESPACE } from "../store/merge-patterns.ts";
import { capUserPatterns } from "../store/cap-patterns.ts";
import { formatTime } from "./format-time.ts";
import {
  formatHistory,
  formatUserFeedback,
  type LogEntry,
  type UserFeedbackEntry,
} from "./history-format.ts";

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

interface ExtractedPattern {
  key: string;
  content: string;
  category: string;
}

function buildExtractionPrompt(
  summary: SceneSummary,
  decision: ActionSelection | undefined,
  existingMemories: Array<{ key: string; value: Record<string, unknown> }>,
  actionDefinitions: Array<{ key: string; value: Record<string, unknown> }>,
  currentTime: Date,
  logEntries?: LogEntry[],
  userFeedback?: UserFeedbackEntry[],
): string {
  const memorySection = existingMemories.length > 0
    ? `## Existing Known Patterns\n${existingMemories.map((m) =>
      `- [${m.key}] ${m.value.content} (category: ${m.value.category}, observed ${m.value.observedCount} times)`
    ).join("\n")}`
    : "## Existing Known Patterns\nNone yet.";

  const actionDefsSection = actionDefinitions.length > 0
    ? `## Current Action Definitions\n${actionDefinitions.map((d) =>
      `- [${d.key}] ${d.value.description}`
    ).join("\n")}`
    : "";

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

  return `You are a behavioral pattern analyzer. Given a current observation, recent history, user feedback, and existing known patterns, identify any new behavioral patterns or confirm existing ones. You may also suggest refinements to action definitions based on observed feedback.

${memorySection}
${actionDefsSection ? `\n${actionDefsSection}\n` : ""}
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
- If user feedback (latest reply or prior replies in history) suggests an action definition should be refined, include an actionUpdate

Return a JSON object (no markdown wrapping):
{
  "patterns": [{"key": "pattern-key", "content": "Description of the pattern", "category": "category"}],
  "actionUpdates": [{"key": "action-name", "description": "Refined description based on feedback"}]
}

If nothing noteworthy: {"patterns": [], "actionUpdates": []}`;
}

interface ActionUpdate {
  key: string;
  description: string;
}

interface LlmResponse {
  patterns: ExtractedPattern[];
  actionUpdates: ActionUpdate[];
}

function parseLlmResponse(jsonStr: string): LlmResponse {
  const parsed = JSON.parse(jsonStr);
  return {
    patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
    actionUpdates: Array.isArray(parsed.actionUpdates) ? parsed.actionUpdates : [],
  };
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
      const [existingItems, actionDefItems, logEntries] = await Promise.all([
        store.search(PATTERNS_NAMESPACE, { limit: 50 }),
        store.search(ACTION_DEFS_NAMESPACE, { limit: 50 }),
        logEntriesPromise,
      ]);

      const existingMemories = existingItems.map((item) => ({
        key: item.key,
        value: item.value,
      }));

      const actionDefinitions = actionDefItems.map((item) => ({
        key: item.key,
        value: item.value,
      }));

      const prompt = buildExtractionPrompt(
        state.summary,
        state.decision,
        existingMemories,
        actionDefinitions,
        currentTime,
        logEntries,
        state.userFeedback,
      );
      const response = await deps.ollama.generate(prompt);
      const jsonStr = extractJson(response);
      const { patterns, actionUpdates } = parseLlmResponse(jsonStr);

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

      for (const update of actionUpdates) {
        if (!update.key || !update.description) continue;

        const existing = await store.get(ACTION_DEFS_NAMESPACE, update.key);
        if (!existing) continue;
        const current = existing.value as ActionDefinitionRecord;
        if (current.source === "seed") continue;

        const record: ActionDefinitionRecord = {
          ...current,
          description: update.description,
          source: "learned",
          updatedAt: now,
        };
        await store.put(ACTION_DEFS_NAMESPACE, update.key, record);
      }
    } catch {
      // best-effort
    }

    return {};
  };
}
