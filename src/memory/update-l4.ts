import type { OllamaAdapter } from "../adapters/ollama.ts";

export interface EvictedL3Entry {
  content: string;
  windowStart: string;
  windowEnd: string;
}

function formatEvictedL3Entries(entries: EvictedL3Entry[]): string {
  return entries.map((entry) => `[${entry.windowStart}..${entry.windowEnd}] ${entry.content}`).join("\n");
}

export async function updateL4(
  ollama: OllamaAdapter,
  currentL4: string,
  evictedL3: EvictedL3Entry[],
  promptTemplate: string,
  maxChars: number,
): Promise<string> {
  const l3Entries = formatEvictedL3Entries(evictedL3);
  const first = evictedL3[0];
  const last = evictedL3[evictedL3.length - 1];
  const prompt = promptTemplate
    .replaceAll("{l4Current}", currentL4)
    .replaceAll("{l3Entries}", l3Entries)
    // Backward-compatible singular placeholders.
    .replaceAll("{l3Content}", l3Entries)
    .replaceAll("{l3WindowStart}", first?.windowStart ?? "")
    .replaceAll("{l3WindowEnd}", last?.windowEnd ?? "")
    .replaceAll("{l4MaxChars}", String(maxChars));

  console.log(
    `[layer-update] L4 update from ${evictedL3.length} expiring L3 summaries ` +
      `[${first?.windowStart ?? "n/a"}..${last?.windowEnd ?? "n/a"}]`,
  );
  const raw = await ollama.generate(prompt);
  const trimmed = raw.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}
