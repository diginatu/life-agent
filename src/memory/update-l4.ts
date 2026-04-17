import type { OllamaAdapter } from "../adapters/ollama.ts";

export interface EvictedL3Entry {
  content: string;
  windowStart: string;
  windowEnd: string;
}

export async function updateL4(
  ollama: OllamaAdapter,
  currentL4: string,
  evictedL3: EvictedL3Entry,
  promptTemplate: string,
  maxChars: number,
): Promise<string> {
  const prompt = promptTemplate
    .replaceAll("{l4Current}", currentL4)
    .replaceAll("{l3Content}", evictedL3.content)
    .replaceAll("{l3WindowStart}", evictedL3.windowStart)
    .replaceAll("{l3WindowEnd}", evictedL3.windowEnd)
    .replaceAll("{l4MaxChars}", String(maxChars));

  console.log(
    `[layer-update] L4 update from expiring L3 [${evictedL3.windowStart}..${evictedL3.windowEnd}]`,
  );
  const raw = await ollama.generate(prompt);
  const trimmed = raw.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}
