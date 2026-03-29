import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface FilesystemAdapter {
  appendJsonLine(dir: string, date: string, data: unknown): Promise<void>;
  readLastNLines(dir: string, date: string, n: number): Promise<unknown[]>;
}

export function createFilesystemAdapter(): FilesystemAdapter {
  return {
    async appendJsonLine(dir, date, data) {
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${date}.jsonl`);
      const line = JSON.stringify(data) + "\n";
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
      const lines = content
        .split("\n")
        .filter((line) => line.trim().length > 0);

      const lastN = lines.slice(-n);
      return lastN.map((line) => JSON.parse(line));
    },
  };
}
