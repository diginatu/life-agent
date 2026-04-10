import type { OllamaAdapter } from "../adapters/ollama.ts";
import { DraftMessageSchema, type DraftMessage } from "../schemas/message.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { ActionSelection } from "../schemas/action.ts";
import type { Config } from "../config.ts";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ACTION_DEFS_NAMESPACE, type ActionDefinitionRecord } from "../store/seed-actions.ts";

interface MessageNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
}

interface MessageNodeState {
  summary?: SceneSummary;
  decision?: ActionSelection;
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

function buildPrompt(summary: SceneSummary, decision: ActionSelection, actionDescription?: string): string {
  const descLine = actionDescription ? `\n- Action description: ${actionDescription}` : "";
  return `You are a friendly personal assistant. Draft a short notification message for the user.

Context:
- Action: ${decision.action}${descLine}
- Reason: ${decision.reason}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Posture: ${summary.posture}

Write a concise notification. Return a JSON object with exactly these fields:
{
  "title": string (short, under 50 chars),
  "body": string (1-2 sentences, friendly tone)
}

Return ONLY the JSON object, no other text.`;
}

export function createMessageNode(deps: MessageNodeDeps) {
  const { actionsConfig } = deps;

  function getFallback(action: string): DraftMessage {
    return actionsConfig.getFallbackMessage(action)
      ?? { title: "Notification", body: "Life Agent has a suggestion for you." };
  }

  return async (state: MessageNodeState, config?: LangGraphRunnableConfig): Promise<MessageNodeResult> => {
    if (!state.decision) {
      return { message: null, errors: ["message: no decision data in state"] };
    }

    if (!actionsConfig.isActiveAction(state.decision.action)) {
      return { message: null };
    }

    if (!state.summary) {
      return {
        message: getFallback(state.decision.action),
        errors: ["message: no summary data, using fallback message"],
      };
    }

    let actionDescription = actionsConfig.getDescription(state.decision.action);
    try {
      if (config?.store) {
        const item = await config.store.get(ACTION_DEFS_NAMESPACE, state.decision.action);
        if (item) {
          actionDescription = (item.value as ActionDefinitionRecord).description;
        }
      }
    } catch {
      // best-effort
    }

    const prompt = buildPrompt(
      state.summary,
      state.decision,
      actionDescription,
    );

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `message: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return {
        message: getFallback(state.decision.action),
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
        message: getFallback(state.decision.action),
        errors: [msg],
      };
    }

    const result = DraftMessageSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `message: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return {
        message: getFallback(state.decision.action),
        errors: [msg],
      };
    }

    return { message: result.data };
  };
}
