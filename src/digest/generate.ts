import type { OllamaAdapter } from "../adapters/ollama.ts";

interface LogEntry {
  timestamp?: string;
  summary?: {
    activityGuess?: string | null;
    [key: string]: unknown;
  };
  decision?: {
    action?: string;
    [key: string]: unknown;
  };
  message?: { title: string; body: string } | null;
  errors?: string[];
  [key: string]: unknown;
}

export interface DayStats {
  totalEntries: number;
  actionCounts: Record<string, number>;
  firstTimestamp?: string;
  lastTimestamp?: string;
  topActivity?: string;
  notificationCount: number;
  errorCount: number;
}

export function buildStats(entries: LogEntry[]): DayStats {
  const actionCounts: Record<string, number> = {};
  const activityCounts: Record<string, number> = {};
  let notificationCount = 0;
  let errorCount = 0;

  for (const entry of entries) {
    const action = entry.decision?.action;
    if (action) {
      actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    }

    const activity = entry.summary?.activityGuess;
    if (activity) {
      activityCounts[activity] = (activityCounts[activity] ?? 0) + 1;
    }

    if (entry.message) {
      notificationCount++;
    }

    if (entry.errors && entry.errors.length > 0) {
      errorCount++;
    }
  }

  let topActivity: string | undefined;
  let topCount = 0;
  for (const [activity, count] of Object.entries(activityCounts)) {
    if (count > topCount) {
      topActivity = activity;
      topCount = count;
    }
  }

  return {
    totalEntries: entries.length,
    actionCounts,
    firstTimestamp: entries[0]?.timestamp,
    lastTimestamp: entries.at(-1)?.timestamp,
    topActivity,
    notificationCount,
    errorCount,
  };
}

function formatStatsMarkdown(date: string, stats: DayStats): string {
  const lines = [`# Daily Digest — ${date}`, ""];

  if (stats.totalEntries === 0) {
    lines.push("No activity recorded for this day.");
    return lines.join("\n");
  }

  lines.push(`**Entries:** ${stats.totalEntries}`);
  if (stats.firstTimestamp && stats.lastTimestamp) {
    lines.push(`**Time range:** ${stats.firstTimestamp} — ${stats.lastTimestamp}`);
  }
  if (stats.topActivity) {
    lines.push(`**Most common activity:** ${stats.topActivity}`);
  }
  lines.push(`**Notifications sent:** ${stats.notificationCount}`);
  if (stats.errorCount > 0) {
    lines.push(`**Entries with errors:** ${stats.errorCount}`);
  }

  lines.push("", "## Action Counts", "");
  for (const [action, count] of Object.entries(stats.actionCounts)) {
    lines.push(`- ${action}: ${count}`);
  }

  return lines.join("\n");
}

function buildDigestPrompt(date: string, stats: DayStats, entries: LogEntry[], previousDigests?: Array<{ date: string; content: string }>): string {
  const statsSummary = formatStatsMarkdown(date, stats);
  const sampleSize = Math.min(entries.length, 20);
  const sampled = entries.slice(0, sampleSize).map((e) => ({
    time: e.timestamp,
    action: e.decision?.action,
    activity: e.summary?.activityGuess,
    posture: e.summary?.activityGuess ? undefined : undefined,
    reason: e.decision?.action !== "log_only" ? (e.decision as Record<string, unknown>)?.reason : undefined,
  }));

  let previousDigestSection = "";
  if (previousDigests && previousDigests.length > 0) {
    previousDigestSection = "\n## Recent Digests (for context — do NOT repeat these observations)\n";
    for (const d of previousDigests) {
      previousDigestSection += `\n[${d.date}]\n${d.content}\n`;
    }
  }

  const hasPreviousContext = previousDigests && previousDigests.length > 0;

  return `You are a personal wellness analyst. Write a concise daily digest in markdown based on the data below.
${previousDigestSection}
## Today's Data — ${date}

${statsSummary}

## Timeline (${sampleSize} of ${entries.length} entries)

${JSON.stringify(sampled, null, 2)}

${hasPreviousContext
    ? `Write a brief 1-3 paragraph summary. Focus ONLY on:
1. What is new or different today compared to recent days
2. Notable changes in patterns, activities, or wellness
3. Any concerning trends or positive improvements

If today was similar to recent days, keep it very short (1 paragraph).
Do NOT repeat patterns already described in recent digests.`
    : `Write a friendly 3-5 paragraph summary covering:
1. Overall patterns (how the day went)
2. Activity breakdown and any notable transitions
3. Wellness observations (breaks taken, posture, etc.)`}

Use markdown formatting. Start with a ## heading. Be concise.`;
}

export async function generateDigest(
  entries: LogEntry[],
  date: string,
  ollama: OllamaAdapter,
  previousDigests?: Array<{ date: string; content: string }>,
): Promise<string> {
  if (entries.length === 0) {
    try {
      return await ollama.generate(
        `Write a very short markdown note saying no activity was recorded for ${date}. Start with "## No activity".`,
      );
    } catch {
      return `# Daily Digest — ${date}\n\nNo activity recorded for this day.`;
    }
  }

  const stats = buildStats(entries);
  const prompt = buildDigestPrompt(date, stats, entries, previousDigests);

  try {
    return await ollama.generate(prompt);
  } catch (err) {
    console.error(`digest: ollama error: ${err instanceof Error ? err.message : String(err)}`);
    return formatStatsMarkdown(date, stats);
  }
}
