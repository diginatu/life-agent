import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import { ActionSelectionSchema, type ActionSelection } from "../schemas/action.ts";
import type { SceneSummary } from "../schemas/summary.ts";
import type { PolicyDecision } from "../schemas/policy.ts";
import type { Config } from "../config.ts";
import { collectPreviousDigests } from "../digest/cli.ts";

interface ActionNodeDeps {
  ollama: OllamaAdapter;
  actionsConfig: Config;
  fs?: FilesystemAdapter;
  logDir?: string;
  historyCount?: number;
  digestDays?: number;
  now?: () => Date;
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

function formatTime(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = days[date.getDay()];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dayOfWeek}, ${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

interface LogEntry {
  timestamp?: string;
  summary?: { activityGuess?: string | null; posture?: string; [key: string]: unknown };
  decision?: { action?: string; reason?: string; [key: string]: unknown };
  feedbackFromPrevious?: { text: string; userId: string; timestamp: string }[];
  tags?: string[];
  content?: string;
  [key: string]: unknown;
}

interface DigestInfo {
  date: string;
  content: string;
}

function formatHistory(entries: LogEntry[], digestInfos?: DigestInfo[]): { history: string; digests: DigestInfo[] } {
  const regularEntries: LogEntry[] = [];
  const digests: DigestInfo[] = [];

  for (const entry of entries) {
    if (entry.tags?.includes("digest")) {
      if (entry.content && entry.digestDate) {
        digests.push({ date: entry.digestDate as string, content: entry.content });
      }
    } else {
      regularEntries.push(entry);
    }
  }

  if (digestInfos) {
    digests.push(...digestInfos);
  }

  const historyLines = regularEntries.map((e) => {
    const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) : "??:??";
    const activity = e.summary?.activityGuess ?? "unknown";
    const posture = e.summary?.posture ?? "unknown";
    const action = e.decision?.action ?? "unknown";
    const reason = e.decision?.reason ?? "";
    let line = `  ${time} | ${posture}, ${activity} → ${action}${reason ? ` (${reason})` : ""}`;
    if (e.feedbackFromPrevious && e.feedbackFromPrevious.length > 0) {
      const replies = e.feedbackFromPrevious.map((f) => f.text).join("; ");
      line += `\n    user reply: ${replies}`;
    }
    return line;
  });

  return {
    history: historyLines.length > 0 ? historyLines.join("\n") : "",
    digests,
  };
}

function buildPrompt(summary: SceneSummary, policy: PolicyDecision, actionsConfig: Config, currentTime: Date, logEntries?: LogEntry[], digestInfos?: DigestInfo[]): string {
  const actionDescriptions = policy.availableActions
    .map((a) => {
      const desc = actionsConfig.getDescription(a);
      return desc ? `  - ${a}: ${desc}` : `  - ${a}`;
    })
    .join("\n");

  const { history, digests } = logEntries ? formatHistory(logEntries, digestInfos) : { history: "", digests: [] as DigestInfo[] };

  let historySections = "";
  if (digests.length > 0) {
    historySections += "\nPrevious digests:\n";
    for (const d of digests) {
      historySections += `\n[${d.date}]\n${d.content}\n`;
    }
  }
  if (history) {
    historySections += `\nRecent history:\n${history}\n`;
  }

  return `You are a personal wellness assistant. Based on the scene analysis and policy constraints, select the most appropriate action.

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

    const now = deps.now ?? (() => new Date());
    const currentTime = now();

    let logEntries: LogEntry[] | undefined;
    let digestInfos: DigestInfo[] | undefined;
    if (deps.fs && deps.logDir) {
      const dateStr = currentTime.toISOString().slice(0, 10);
      try {
        logEntries = await deps.fs.readLastNLines(deps.logDir, dateStr, deps.historyCount ?? 10) as LogEntry[];
      } catch {
        // History is best-effort; continue without it
      }

      const digestDays = deps.digestDays ?? 1;
      if (digestDays > 0) {
        digestInfos = await collectPreviousDigests(deps.fs, deps.logDir, dateStr, digestDays);
      } else {
        // Suppress digests from current day's entries too
        if (logEntries) {
          logEntries = logEntries.filter((e) => !e.tags?.includes("digest"));
        }
      }
    }

    const prompt = buildPrompt(state.summary, state.policy, deps.actionsConfig, currentTime, logEntries, digestInfos);

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
