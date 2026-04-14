import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import { ActionSelectionSchema, type ActionSelection } from "../schemas/action.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { Config } from "../config.ts";
import { formatTime } from "./format-time.ts";
import {
  formatHistory,
  formatUserFeedback,
  type LogEntry,
  type UserFeedbackEntry,
} from "./history-format.ts";

interface ActionNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  historyCount?: number;
  now?: () => Date;
}

interface ActionNodeState {
  summary?: SceneSummary;
  userFeedback?: UserFeedbackEntry[];
}

interface ActionNodeResult {
  decision?: ActionSelection;
  errors?: string[];
}

const FALLBACK_DECISION: ActionSelection = {
  action: "none",
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

function buildPrompt(summary: SceneSummary, actionsConfig: Config, currentTime: Date, logEntries?: LogEntry[], userFeedback?: UserFeedbackEntry[]): string {
  const allActions = actionsConfig.getActionNames();
  const actionDescriptions = allActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  const { history } = logEntries ? formatHistory(logEntries) : { history: "" };

  let historySections = "";
  historySections += formatUserFeedback(userFeedback);
  if (history) {
    historySections += `\nRecent history:\n${history}\n`;
  }

  return `You are a personal assistant. Based on the scene analysis and history, select the most appropriate action.

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
${!userFeedback || userFeedback.length === 0 ? "\nIMPORTANT: There are no new user messages in this cycle. Do NOT just \"reply\"" : "\nIMPORTANT: The user has sent a new message this cycle. You MUST choose an action that acknowledges their message. Do NOT choose \"none\" when the user is actively communicating with you."}
You MUST choose an action from the available actions list above. Return a JSON object with exactly these fields:
{
  "reason": string explaining your choice
  "priority": "low" | "medium" | "high",
  "action": one of ${JSON.stringify(allActions)},
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

    const now = deps.now ?? (() => new Date());
    const currentTime = now();

    let logEntries: LogEntry[] | undefined;
    if (deps.fs && deps.logDir) {
      const dateStr = currentTime.toISOString().slice(0, 10);
      try {
        logEntries = await deps.fs.readLastNLinesAcrossDays(deps.logDir, dateStr, deps.historyCount ?? 10) as LogEntry[];
      } catch {
        // History is best-effort; continue without it
      }
    }

    const prompt = buildPrompt(state.summary, deps.actionsConfig, currentTime, logEntries, state.userFeedback);

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
