import { describe, expect, test } from "bun:test";
import {
  formatHistory,
  formatRelative,
  formatUserFeedback,
  type LogEntry,
  type UserFeedbackEntry,
} from "../../src/nodes/history-format.ts";
import { formatLocalDateTime } from "../../src/nodes/format-time.ts";

const NOW = new Date("2026-04-18T14:30:00Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function agoIso(ms: number): string {
  return ago(ms).toISOString();
}

describe("formatRelative", () => {
  test("returns 'just now' for diffs under 45 seconds", () => {
    expect(formatRelative(ago(10_000), NOW)).toBe("just now");
    expect(formatRelative(ago(44_000), NOW)).toBe("just now");
  });

  test("returns minutes for diffs under 1 hour", () => {
    expect(formatRelative(ago(2 * 60_000), NOW)).toBe("2 minutes ago");
    expect(formatRelative(ago(45 * 60_000), NOW)).toBe("45 minutes ago");
  });

  test("returns hours for diffs under 1 day", () => {
    expect(formatRelative(ago(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(formatRelative(ago(2 * 3_600_000), NOW)).toBe("2 hours ago");
    expect(formatRelative(ago(10 * 3_600_000), NOW)).toBe("10 hours ago");
  });

  test("returns days for diffs of 1 day or more", () => {
    expect(formatRelative(ago(24 * 3_600_000), NOW)).toBe("1 day ago");
    expect(formatRelative(ago(50 * 3_600_000), NOW)).toBe("2 days ago");
  });

  test("clamps negative diffs (clock skew) to 'just now'", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(formatRelative(future, NOW)).toBe("just now");
  });
});

describe("formatUserFeedback", () => {
  test("appends relative suffix inside the bracket when now is provided", () => {
    const feedback: UserFeedbackEntry[] = [
      { text: "hello", userId: "u1", timestamp: agoIso(10 * 3_600_000) },
    ];
    const out = formatUserFeedback(feedback, NOW);
    expect(out).toContain(", 10 hours ago]");
    expect(out).toContain("hello");
  });

  test("handles missing timestamp without relative suffix", () => {
    const feedback: UserFeedbackEntry[] = [
      { text: "no ts", userId: "u1", timestamp: "" },
    ];
    const out = formatUserFeedback(feedback, NOW);
    expect(out).toContain("[??:??] no ts");
    expect(out).not.toContain("ago");
  });

  test("returns empty string when feedback is empty or undefined", () => {
    expect(formatUserFeedback([], NOW)).toBe("");
    expect(formatUserFeedback(undefined, NOW)).toBe("");
  });
});

describe("formatHistory", () => {
  const entries: LogEntry[] = [
    {
      timestamp: agoIso(10 * 3_600_000),
      summary: { activityGuess: "coding", posture: "sitting" },
      decision: { action: "nudge_break", reason: "long session" },
    },
  ];

  test("appends relative suffix when now is provided", () => {
    const { history } = formatHistory(entries, NOW);
    expect(history).toContain("(10 hours ago)");
    expect(history).toContain("sitting, coding");
    expect(history).toContain("nudge_break");
  });

  test("omits relative suffix when now is not provided (summarize-layer path)", () => {
    const { history } = formatHistory(entries);
    expect(history).not.toContain("ago)");
    expect(history).not.toContain("just now");
    expect(history).toContain("sitting, coding");
  });

  test("includes local datetime and relative age for user replies in recent history", () => {
    const replyTs = "2026-04-18T14:20:00.000Z";
    const { history } = formatHistory(
      [{
        ...entries[0],
        feedbackFromPrevious: [{ text: "line1\nline2", userId: "u1", timestamp: replyTs }],
      }],
      NOW,
    );

    expect(history).toContain(`user reply [${formatLocalDateTime(new Date(replyTs))}, 10 minutes ago]: line1`);
    expect(history).toContain("      line2");
  });
});
