import type { BaseStore } from "@langchain/langgraph";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { Config } from "../config.ts";
import type { ActionSelection } from "../schemas/action.ts";
import { type DraftMessage, DraftMessageSchema } from "../schemas/message.ts";
import type { Plan } from "../schemas/plan.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import { formatUserFeedback, type UserFeedbackEntry } from "./history-format.ts";
import { formatMemoryContext, loadMemoryContext } from "./memory-context.ts";
import { formatPlanContext } from "./plan-format.ts";

interface MessageNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  store?: BaseStore;
  l2DelayHours?: number;
  now?: () => Date;
}

interface MessageNodeState {
  summary?: SceneSummary;
  decision?: ActionSelection;
  plan?: Plan;
  userFeedback?: UserFeedbackEntry[];
}

interface MessageNodeResult {
  message?: DraftMessage | null;
  errors?: string[];
}

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildPrompt(
  summary: SceneSummary,
  decision: ActionSelection,
  responseStyle: string,
  planSection: string,
  memorySection: string,
  currentTime: Date,
  actionDescriptions: string,
  userFeedback?: UserFeedbackEntry[],
): string {
  const feedbackSection = formatUserFeedback(userFeedback, currentTime);
  return `You are a personal assistant. Draft a mention post for the user according to the context.
This message will be posted in a Discord channel and will mention the user. Do no include the mention in the body.
Follow this response style: ${responseStyle}.

Context:
- Actions: ${decision.actions.join(", ")}
- Action descriptions:
${actionDescriptions}
- Reason: ${decision.reason}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Posture: ${summary.posture}
${feedbackSection}${memorySection}
${planSection}
Use the 24-hour plan as guidance, but prioritize the current scene and latest user feedback.
Return a JSON object with exactly this field:
{
  "body": string (the message content; may be multiple sentences)
}

Return ONLY the JSON object, no other text.`;
}

export function createMessageNode(deps: MessageNodeDeps) {
  const { actionsConfig } = deps;

  function getFallback(actions: string[]): DraftMessage {
    const fallbackBodies = actions
      .filter((action) => actionsConfig.isActiveAction(action))
      .map((action) => actionsConfig.getFallbackMessage(action)?.body)
      .filter((body): body is string => Boolean(body));

    if (fallbackBodies.length === 0) {
      return { body: "Life Agent has a suggestion for you." };
    }

    return { body: fallbackBodies.join("\n") };
  }

  return async (state: MessageNodeState): Promise<MessageNodeResult> => {
    if (!state.decision) {
      return { message: null, errors: ["message: no decision data in state"] };
    }

    const selectedActions = state.decision.actions;
    const hasActiveAction = selectedActions.some((action) => actionsConfig.isActiveAction(action));
    if (!hasActiveAction) {
      return { message: null };
    }

    if (!state.summary) {
      return {
        message: getFallback(selectedActions),
        errors: ["message: no summary data, using fallback message"],
      };
    }

    const actionDescriptions = selectedActions
      .map((action) => {
        const description = actionsConfig.getDescription(action);
        return description ? `  - ${action}: ${description}` : `  - ${action}`;
      })
      .join("\n");

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
      state.decision,
      actionsConfig.settings.responseStyle,
      formatPlanContext(state.plan),
      formatMemoryContext(memory, currentTime),
      currentTime,
      actionDescriptions,
      state.userFeedback,
    );

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `message: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return {
        message: getFallback(selectedActions),
        errors: [msg],
      };
    }

    const jsonStr = extractJson(rawResponse);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const msg = `message: failed to parse JSON: ${jsonStr.slice(0, 200)}`;
      console.error(msg);
      return {
        message: getFallback(selectedActions),
        errors: [msg],
      };
    }

    const result = DraftMessageSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `message: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return {
        message: getFallback(selectedActions),
        errors: [msg],
      };
    }

    return { message: result.data };
  };
}
