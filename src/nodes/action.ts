import type { BaseStore } from "@langchain/langgraph";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { Config } from "../config.ts";
import { type ActionSelection, ActionSelectionSchema } from "../schemas/action.ts";
import type { Plan } from "../schemas/plan.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import { formatTime } from "./format-time.ts";
import { formatUserFeedback, type UserFeedbackEntry } from "./history-format.ts";
import { formatMemoryContext, loadMemoryContext } from "./memory-context.ts";
import { formatPlanContext } from "./plan-format.ts";

interface ActionNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  store?: BaseStore;
  l2DelayHours?: number;
  now?: () => Date;
}

interface ActionNodeState {
  summary?: SceneSummary;
  plan?: Plan;
  userFeedback?: UserFeedbackEntry[];
}

interface ActionNodeResult {
  decision?: ActionSelection;
  errors?: string[];
}

const FALLBACK_DECISION: ActionSelection = {
  actions: ["none"],
  reason: "fallback: action selection failed",
};

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildPrompt(
  summary: SceneSummary,
  actionsConfig: Config,
  currentTime: Date,
  planSection: string,
  memorySection: string,
  userFeedback?: UserFeedbackEntry[],
): string {
  const allActions = actionsConfig.getActionNames();
  const actionDescriptions = allActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  const historySections = formatUserFeedback(userFeedback, currentTime) + planSection + memorySection;

  return `You are a personal assistant. Based on the scene analysis and history, select one or more appropriate actions.

Scene analysis:
- Person present: ${summary.personPresent}
- Posture: ${summary.posture}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Confidence: ${summary.confidence}

Current time:
- ${formatTime(currentTime)}

${historySections}

Available actions:
${actionDescriptions}

${!userFeedback || userFeedback.length === 0 ? '\nIMPORTANT: There are no new user messages in this cycle. Do NOT just "reply"' : '\nIMPORTANT: The user has sent a new message this cycle.'}
${userFeedback && userFeedback.length > 0 ? '\nIMPORTANT: When there is a new user message, do not choose "none" unless truly unavoidable.' : ""}
IMPORTANT: If the 24-hour plan conflicts with the current scene or latest user feedback, prioritize current scene and latest user feedback.
You MUST choose one or more actions from the available actions list above. Return a JSON object with exactly these fields:
{
  "reason": string explaining your choice
  "actions": array of unique actions chosen from ${JSON.stringify(allActions)},
}

IMPORTANT: If you choose "none", it must be the only selected action.

Return ONLY the JSON object, no other text.`;
}

export function createActionNode(deps: ActionNodeDeps) {
  return async (state: ActionNodeState): Promise<ActionNodeResult> => {
    if (!state.summary) {
      return {
        decision: FALLBACK_DECISION,
        errors: ["action: no summary data in state"],
      };
    }

    const now = deps.now ?? (() => new Date());
    const currentTime = now();

    const memory = await loadMemoryContext({
      store: deps.store,
      fs: deps.fs,
      logDir: deps.logDir,
      l2DelayHours: deps.l2DelayHours,
      now,
    });

    const prompt = buildPrompt(
      state.summary,
      deps.actionsConfig,
      currentTime,
      formatPlanContext(state.plan),
      formatMemoryContext(memory, currentTime),
      state.userFeedback,
    );

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `action: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    const jsonStr = extractJson(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const msg = `action: failed to parse JSON from ollama response: ${jsonStr.slice(0, 200)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    const result = ActionSelectionSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `action: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    return { decision: result.data };
  };
}
