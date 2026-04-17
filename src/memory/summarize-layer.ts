import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { LogEntry } from "../nodes/history-format.ts";
import { formatHistory } from "../nodes/history-format.ts";

export interface L2Entry {
  content: string;
  windowStart: string;
  windowEnd: string;
  sourceCount: number;
}

/** Summarize L1 log entries into an L2 hourly summary. */
export async function summarizeLayer(
  ollama: OllamaAdapter,
  entries: LogEntry[],
  windowLabel: string,
): Promise<string> {
  const { history } = formatHistory(entries);
  const prompt = `Summarize the activity log for time window "${windowLabel}". Write 1-3 concise sentences describing what the person was doing, their posture, and any notable events, actions or user information. Keep the detail like time, number, name or action for important information.\n\nActivity log:\n${history}`;
  console.log(`[layer-update] Summarizing window "${windowLabel}" (${entries.length} entries)`);
  return ollama.generate(prompt);
}

/** Summarize L2 hourly summaries into an L3 6-hour summary. */
export async function summarizeL3(
  ollama: OllamaAdapter,
  l2Entries: L2Entry[],
  windowLabel: string,
): Promise<string> {
  const lines = l2Entries.map((e) => `[${e.windowStart}] ${e.content}`).join("\n");
  const prompt = `Summarize the following hourly summaries for time window "${windowLabel}". Write 2-5 concise sentences describing what the person was doing, their posture, and any notable events, actions or user information. Keep the detail like time, number, name or action for important information.\n\nHourly summaries:\n${lines}`;
  console.log(
    `[layer-update] Summarizing L3 window "${windowLabel}" (${l2Entries.length} L2 entries)`,
  );
  return ollama.generate(prompt);
}
