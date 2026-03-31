import { createFilesystemAdapter } from "../adapters/filesystem.ts";
import { createOllamaAdapterFromConfig } from "../adapters/ollama.ts";
import { generateDigest } from "./generate.ts";
import type { Config } from "../config.ts";
import type { FilesystemAdapter } from "../adapters/filesystem.ts";
import type { OllamaAdapter } from "../adapters/ollama.ts";
import type { DiscordAdapter } from "../adapters/discord.ts";

interface DigestDeps {
  fs?: FilesystemAdapter;
  ollama?: OllamaAdapter;
  discord?: DiscordAdapter;
}

export async function runDigest(config: Config, date: string, deps: DigestDeps = {}): Promise<void> {
  const fs = deps.fs ?? createFilesystemAdapter();
  const ollama = deps.ollama ?? createOllamaAdapterFromConfig(config.settings);

  const entries = await fs.readLastNLines(config.settings.logDir, date, 10000);

  const markdown = await generateDigest(entries as Record<string, unknown>[], date, ollama);

  console.log(markdown);

  if (deps.discord) {
    try {
      await deps.discord.sendEmbed(`Daily Digest — ${date}`, markdown);
      console.log("Digest sent to Discord.");
    } catch (err) {
      console.error(`digest: discord error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await writeDigestMarker(fs, config.settings.logDir, date, new Date());
}

export async function shouldRunDigest(
  fs: FilesystemAdapter, logDir: string, now: Date,
): Promise<boolean> {
  const dateStr = now.toISOString().slice(0, 10);
  let entries: unknown[];
  try {
    entries = await fs.readLastNLines(logDir, dateStr, 100);
  } catch {
    return true;
  }
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const tags = e.tags as string[] | undefined;
    if (tags?.includes("digest")) {
      const ts = new Date(e.timestamp as string);
      const hoursAgo = (now.getTime() - ts.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 24) return false;
    }
  }
  return true;
}

export async function writeDigestMarker(
  fs: FilesystemAdapter, logDir: string, digestDate: string, now: Date,
): Promise<void> {
  const dateStr = now.toISOString().slice(0, 10);
  await fs.appendJsonLine(logDir, dateStr, {
    eventId: crypto.randomUUID(),
    timestamp: now.toISOString(),
    tags: ["digest"],
    digestDate,
  });
}
