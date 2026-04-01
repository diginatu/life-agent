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

export async function collectPreviousDigests(
  fs: FilesystemAdapter, logDir: string, targetDate: string, days: number,
): Promise<Array<{ date: string; content: string }>> {
  if (days <= 0) return [];

  const seen = new Map<string, { date: string; content: string }>();
  const target = new Date(targetDate + "T00:00:00.000Z");
  const windowStart = new Date(target);
  windowStart.setDate(windowStart.getDate() - days);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  // Scan log files from targetDate back through the window (inclusive of targetDate for cross-file storage)
  for (let i = 0; i <= days; i++) {
    const d = new Date(target);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    try {
      const entries = await fs.readLastNLines(logDir, dateStr, 1000);
      for (const entry of entries) {
        const e = entry as Record<string, unknown>;
        const tags = e.tags as string[] | undefined;
        if (!tags?.includes("digest") || !e.content) continue;
        const digestDate = e.digestDate as string;
        if (!digestDate || digestDate >= targetDate || digestDate < windowStartStr) continue;
        if (!seen.has(digestDate)) {
          seen.set(digestDate, { date: digestDate, content: e.content as string });
        }
      }
    } catch {
      // Best-effort
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function runDigest(config: Config, date: string, deps: DigestDeps = {}): Promise<void> {
  const fs = deps.fs ?? createFilesystemAdapter();
  const ollama = deps.ollama ?? createOllamaAdapterFromConfig(config.settings);

  const entries = await fs.readLastNLines(config.settings.logDir, date, 10000);

  const previousDigests = await collectPreviousDigests(
    fs, config.settings.logDir, date, config.settings.digestContextDays ?? 3,
  );

  const markdown = await generateDigest(entries as Record<string, unknown>[], date, ollama, previousDigests);

  console.log(markdown);

  if (deps.discord) {
    try {
      await deps.discord.sendEmbed(`Daily Digest — ${date}`, markdown);
      console.log("Digest sent to Discord.");
    } catch (err) {
      console.error(`digest: discord error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await writeDigestMarker(fs, config.settings.logDir, date, new Date(), markdown);
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
  fs: FilesystemAdapter, logDir: string, digestDate: string, now: Date, content?: string,
): Promise<void> {
  const dateStr = now.toISOString().slice(0, 10);
  await fs.appendJsonLine(logDir, dateStr, {
    eventId: crypto.randomUUID(),
    timestamp: now.toISOString(),
    tags: ["digest"],
    digestDate,
    ...(content != null && { content }),
  });
}
