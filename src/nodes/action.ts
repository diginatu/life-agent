import type { OllamaAdapter } from "../adapters/ollama.ts";
import { ActionSelectionSchema, type ActionSelection } from "../schemas/action.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { PolicyDecision } from "../schemas/policy.ts";
import type { Config } from "../config.ts";

interface ActionNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
}

interface ActionNodeState {
  summary?: SceneSummary;
  policy?: PolicyDecision;
}

interface ActionNodeResult {
  decision?: ActionSelection;
  errors?: string[];
}

const FALLBACK_DECISION: ActionSelection = {
  action: "log_only",
  priority: "low",
  reason: "fallback: action selection failed",
};

function extractJson(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1]!.trim();
  }
  return text.trim();
}

function buildPrompt(summary: SceneSummary, policy: PolicyDecision, actionsConfig: Config): string {
  const actionDescriptions = policy.availableActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  return `You are a personal wellness assistant. Based on the scene analysis and policy constraints, select the most appropriate action.

Scene analysis:
- Person present: ${summary.personPresent}
- Posture: ${summary.posture}
- Scene: ${summary.scene}
- Activity: ${summary.activityGuess ?? "unknown"}
- Confidence: ${summary.confidence}

Available actions:
${actionDescriptions}

Policy constraints:
- Reasons: ${policy.reasons.length > 0 ? policy.reasons.join("; ") : "none"}

You MUST choose an action from the available actions list above. Return a JSON object with exactly these fields:
{
  "action": one of ${JSON.stringify(policy.availableActions)},
  "priority": "low" | "medium" | "high",
  "reason": string explaining your choice
}

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

    if (!state.policy) {
      return {
        decision: FALLBACK_DECISION,
        errors: ["action: no policy data in state"],
      };
    }

    const prompt = buildPrompt(state.summary, state.policy, deps.actionsConfig);

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

    // Enforce policy constraint: selected action must be in availableActions
    if (!state.policy.availableActions.includes(result.data.action)) {
      const msg = `action: LLM selected "${result.data.action}" not in available actions ${JSON.stringify(state.policy.availableActions)}, falling back`;
      console.error(msg);
      return { decision: FALLBACK_DECISION, errors: [msg] };
    }

    return { decision: result.data };
  };
}
