import type { OllamaAdapter } from "../adapters/ollama.ts";
import { DraftMessageSchema, type DraftMessage } from "../schemas/message.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { ActionSelection } from "../schemas/action.ts";

interface MessageNodeDeps {
  ollama: OllamaAdapter;
}

interface MessageNodeState {
  summary?: SceneSummary;
  decision?: ActionSelection;
}

interface MessageNodeResult {
  message?: DraftMessage | null;
  errors?: string[];
}

const PASSIVE_ACTIONS = new Set(["none", "log_only"]);

const FALLBACK_MESSAGES: Record<string, DraftMessage> = {
  nudge_break: {
    title: "Time for a break",
    body: "You've been working for a while. Consider standing up and stretching.",
  },
  nudge_sleep: {
    title: "Time to wind down",
    body: "It's getting late. Consider wrapping up and heading to bed.",
  },
};

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildPrompt(summary: SceneSummary, decision: ActionSelection): string {
  return `You are a friendly personal wellness assistant. Draft a short desktop notification for the user.

Context:
- Action: ${decision.action}
- Reason: ${decision.reason}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Posture: ${summary.posture}

Write a warm, concise notification. Return a JSON object with exactly these fields:
{
  "title": string (short, under 50 chars),
  "body": string (1-2 sentences, friendly tone)
}

Return ONLY the JSON object, no other text.`;
}

export function createMessageNode(deps: MessageNodeDeps) {
  return async (state: MessageNodeState): Promise<MessageNodeResult> => {
    if (!state.decision) {
      return { message: null, errors: ["message: no decision data in state"] };
    }

    if (PASSIVE_ACTIONS.has(state.decision.action)) {
      return { message: null };
    }

    if (!state.summary) {
      return {
        message: FALLBACK_MESSAGES[state.decision.action] ?? FALLBACK_MESSAGES.nudge_break!,
        errors: ["message: no summary data, using fallback message"],
      };
    }

    const prompt = buildPrompt(state.summary, state.decision);

    let rawResponse: string;
    try {
      rawResponse = await deps.ollama.generate(prompt);
    } catch (err) {
      const msg = `message: ollama error: ${err instanceof Error ? err.message : String(err)}`;
      console.error(msg);
      return {
        message: FALLBACK_MESSAGES[state.decision.action] ?? FALLBACK_MESSAGES.nudge_break!,
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
        message: FALLBACK_MESSAGES[state.decision.action] ?? FALLBACK_MESSAGES.nudge_break!,
        errors: [msg],
      };
    }

    const result = DraftMessageSchema.safeParse(parsed);
    if (!result.success) {
      const msg = `message: schema validation failed: ${JSON.stringify(result.error.issues)}`;
      console.error(msg);
      return {
        message: FALLBACK_MESSAGES[state.decision.action] ?? FALLBACK_MESSAGES.nudge_break!,
        errors: [msg],
      };
    }

    return { message: result.data };
  };
}
