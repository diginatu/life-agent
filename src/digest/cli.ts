import { createFilesystemAdapter } from "../adapters/filesystem.ts";
import { createOllamaAdapterFromConfig } from "../adapters/ollama.ts";
import { generateDigest } from "./generate.ts";
import type { Config } from "../config.ts";

export async function runDigest(config: Config, date: string): Promise<void> {
  const fs = createFilesystemAdapter();
  const ollama = createOllamaAdapterFromConfig(config.settings);

  const entries = await fs.readLastNLines(config.settings.logDir, date, 10000);

  const markdown = await generateDigest(entries as Record<string, unknown>[], date, ollama);

  console.log(markdown);
}
