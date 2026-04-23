import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface FilesystemAdapter {
  appendJsonLine(dir: string, date: string, data: unknown): Promise<void>;
  readLastNLines(dir: string, date: string, n: number): Promise<unknown[]>;
  readLastNLinesAcrossDays(
    dir: string,
    date: string,
    n: number,
    maxDaysBack?: number,
  ): Promise<unknown[]>;
  readAllLinesForDay(dir: string, date: string): Promise<unknown[]>;
  readEntriesSince(logDir: string, sinceIso: string, maxDays?: number): Promise<unknown[]>;
  pruneEntriesBefore(logDir: string, beforeIso: string): Promise<void>;
}

const LOG_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function createFilesystemAdapter(): FilesystemAdapter {
  return {
    async appendJsonLine(dir, date, data) {
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${date}.jsonl`);
      const line = `${JSON.stringify(data)}\n`;
      const file = Bun.file(filePath);
      const existing = (await file.exists()) ? await file.text() : "";
      await Bun.write(filePath, existing + line);
    },

    async readLastNLines(dir, date, n) {
      const filePath = join(dir, `${date}.jsonl`);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return [];
      }

      const content = await file.text();
      const lines = content.split("\n").filter((line) => line.trim().length > 0);

      const lastN = lines.slice(-n);
      return lastN.map((line) => JSON.parse(line));
    },

    async readAllLinesForDay(dir, date) {
      const filePath = join(dir, `${date}.jsonl`);
      const file = Bun.file(filePath);
      if (!(await file.exists())) return [];
      const content = await file.text();
      return content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
    },

    async readEntriesSince(logDir, sinceIso, maxDays = 14) {
      const result: unknown[] = [];
      const today = new Date();

      for (let i = 0; i <= maxDays; i++) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entries = await this.readAllLinesForDay(logDir, dateStr);

        const newer = entries.filter((e) => {
          const entry = e as { timestamp?: string };
          return entry.timestamp != null && entry.timestamp > sinceIso;
        });

        result.unshift(...newer);

        // Stop scanning if all entries on this day are <= sinceIso
        if (entries.length > 0 && newer.length === 0) {
          break;
        }
      }

      return result;
    },

    async pruneEntriesBefore(logDir, beforeIso) {
      let names: string[];
      try {
        names = await readdir(logDir);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return;
        throw error;
      }

      const before = new Date(beforeIso);
      if (Number.isNaN(before.getTime())) {
        throw new Error(`Invalid pruneEntriesBefore cutoff: ${beforeIso}`);
      }

      const boundaryDate = before.toISOString().slice(0, 10);

      for (const name of names) {
        const match = name.match(LOG_FILE_RE);
        if (!match) continue;

        const date = match[1]!;
        const filePath = join(logDir, name);

        if (date < boundaryDate) {
          await unlink(filePath);
          continue;
        }

        if (date > boundaryDate) {
          continue;
        }

        const entries = await this.readAllLinesForDay(logDir, date);
        const keptEntries = entries.filter((entry) => {
          const timestamp = (entry as { timestamp?: string }).timestamp;
          return timestamp == null || timestamp >= beforeIso;
        });

        if (keptEntries.length === 0) {
          await unlink(filePath);
          continue;
        }

        await Bun.write(filePath, `${keptEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
      }
    },

    async readLastNLinesAcrossDays(dir, date, n, maxDaysBack = 1) {
      const collected: unknown[] = [];
      const startDate = new Date(`${date}T00:00:00.000Z`);

      for (let i = 0; i <= maxDaysBack && collected.length < n; i++) {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entries = await this.readLastNLines(dir, dateStr, n - collected.length);
        collected.unshift(...entries);
      }

      return collected.slice(-n);
    },
  };
}
