import type { z } from "zod/v4";
import type { UserFeedbackSchema } from "../state.ts";

export type UserFeedbackEntry = z.infer<typeof UserFeedbackSchema>[number];

export interface LogEntry {
  timestamp?: string;
  summary?: { activityGuess?: string | null; posture?: string;[key: string]: unknown };
  decision?: { action?: string; reason?: string;[key: string]: unknown };
  message?: { body?: string } | null;
  feedbackFromPrevious?: { text: string; userId: string; timestamp: string }[];
  tags?: string[];
  content?: string;
  [key: string]: unknown;
}

export function formatHistory(entries: LogEntry[]): { history: string } {
  const regularEntries = entries.filter((e) => !e.tags?.includes("digest"));

  const historyLines = regularEntries.map((e) => {
    const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "??:??";
    const activity = e.summary?.activityGuess ?? "unknown";
    const posture = e.summary?.posture ?? "unknown";
    const action = e.decision?.action ?? "unknown";
    const reason = e.decision?.reason ?? "";
    let line = `  ${time} | ${posture}, ${activity} → ${action}${reason ? ` (${reason})` : ""}`;
    if (e.message?.body) {
      line += `\n    agent message: ${e.message.body}`;
    }
    if (e.feedbackFromPrevious && e.feedbackFromPrevious.length > 0) {
      const replies = e.feedbackFromPrevious.map((f) => f.text).join("; ");
      line += `\n    user reply: ${replies}`;
    }
    return line;
  });

  return {
    history: historyLines.length > 0 ? historyLines.join("\n") : "",
  };
}

export function formatUserFeedback(feedback: UserFeedbackEntry[] | undefined): string {
  if (!feedback || feedback.length === 0) return "";
  const lines = feedback.map((f) => {
    const time = f.timestamp
      ? new Date(f.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
      : "??:??";
    return `  - [${time}] ${f.text}`;
  });
  return `\nLatest user reply (since last nudge):\n${lines.join("\n")}\n`;
}
