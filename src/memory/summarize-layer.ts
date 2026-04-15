import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { LogEntry } from "../nodes/history-format.ts";
import { formatHistory } from "../nodes/history-format.ts";

export async function summarizeLayer(
  ollama: OllamaAdapter,
  entries: LogEntry[],
  windowLabel: string,
): Promise<string> {
  const { history } = formatHistory(entries);
  const prompt = `Summarize the activity log for time window "${windowLabel}". Write 2-3 concise sentences describing what the person was doing, their posture, and any notable events, actions or user information.\n\nActivity log:\n${history}`;
  return ollama.generate(prompt);
}
