import type { z } from "zod/v4";
import type { UserFeedbackSchema } from "../state.ts";

export type UserFeedbackEntry = z.infer<typeof UserFeedbackSchema>[number];

export interface LogEntry {
  timestamp?: string;
  summary?: { activityGuess?: string | null; posture?: string; [key: string]: unknown };
  decision?: { actions?: string[]; action?: string; reason?: string; [key: string]: unknown };
  message?: { body?: string } | null;
  feedbackFromPrevious?: { text: string; userId: string; timestamp: string }[];
  tags?: string[];
  content?: string;
  [key: string]: unknown;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

function formatTimeOfDay(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatRelative(past: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - past.getTime());
  if (diffMs < 45_000) return "just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(diffMs / 86_400_000);
  return rtf.format(-days, "day");
}

export function formatHistory(entries: LogEntry[], now?: Date): { history: string } {
  const regularEntries = entries.filter((e) => !e.tags?.includes("digest"));

  const historyLines = regularEntries.map((e) => {
    const parsed = e.timestamp ? new Date(e.timestamp) : null;
    const time = parsed ? formatTimeOfDay(parsed) : "??:??";
    const relativeSuffix = now && parsed ? ` (${formatRelative(parsed, now)})` : "";
    const activity = e.summary?.activityGuess ?? "unknown";
    const posture = e.summary?.posture ?? "unknown";
    const actions = Array.isArray(e.decision?.actions)
      ? e.decision.actions
      : e.decision?.action
        ? [e.decision.action]
        : [];
    const action = actions.length > 0 ? actions.join(",") : "unknown";
    const reason = e.decision?.reason ?? "";
    let line = `  ${time}${relativeSuffix} | ${posture}, ${activity} → ${action}${reason ? ` (${reason})` : ""}`;
    if (e.feedbackFromPrevious && e.feedbackFromPrevious.length > 0) {
      const replies = e.feedbackFromPrevious.map((f) => f.text).join("; ");
      line += `\n    user reply: ${replies}`;
    }
    if (e.message?.body) {
      line += `\n    agent message: ${e.message.body}`;
    }
    return line;
  });

  return {
    history: historyLines.length > 0 ? historyLines.join("\n") : "",
  };
}

export function formatUserFeedback(feedback: UserFeedbackEntry[] | undefined, now: Date): string {
  if (!feedback || feedback.length === 0) return "";
  const lines = feedback.map((f) => {
    if (!f.timestamp) return `  - [??:??] ${f.text}`;
    const parsed = new Date(f.timestamp);
    return `  - [${formatTimeOfDay(parsed)}, ${formatRelative(parsed, now)}] ${f.text}`;
  });
  return `\nLatest user reply (since last nudge):\n${lines.join("\n")}\n`;
}
