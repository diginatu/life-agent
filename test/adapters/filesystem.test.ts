import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFilesystemAdapter } from "../../src/adapters/filesystem.ts";

const TEST_TMP_BASE = resolve(import.meta.dir, "../../.test-tmp");

describe("FilesystemAdapter", () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(TEST_TMP_BASE, { recursive: true });
    dir = await mkdtemp(join(TEST_TMP_BASE, "fs-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  describe("appendJsonLine", () => {
    test("creates file and writes one line", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-29", { hello: "world" });

      const file = Bun.file(join(dir, "2026-03-29.jsonl"));
      const content = await file.text();
      expect(content).toBe('{"hello":"world"}\n');
    });

    test("appends multiple lines to same file", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-29", { a: 1 });
      await adapter.appendJsonLine(dir, "2026-03-29", { b: 2 });
      await adapter.appendJsonLine(dir, "2026-03-29", { c: 3 });

      const file = Bun.file(join(dir, "2026-03-29.jsonl"));
      const content = await file.text();
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]!)).toEqual({ a: 1 });
      expect(JSON.parse(lines[2]!)).toEqual({ c: 3 });
    });

    test("writes to different date files", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-28", { day: 28 });
      await adapter.appendJsonLine(dir, "2026-03-29", { day: 29 });

      const file28 = Bun.file(join(dir, "2026-03-28.jsonl"));
      const file29 = Bun.file(join(dir, "2026-03-29.jsonl"));
      expect(await file28.exists()).toBe(true);
      expect(await file29.exists()).toBe(true);
    });

    test("creates directory if it does not exist", async () => {
      const adapter = createFilesystemAdapter();
      const nestedDir = join(dir, "subdir", "logs");
      await adapter.appendJsonLine(nestedDir, "2026-03-29", { nested: true });

      const file = Bun.file(join(nestedDir, "2026-03-29.jsonl"));
      expect(await file.exists()).toBe(true);
    });
  });

  describe("readLastNLinesAcrossDays", () => {
    test("returns entries from today when today has enough", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 1 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 2 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 3 });

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ i: 2 });
      expect(result[1]).toEqual({ i: 3 });
    });

    test("falls back to yesterday when today is empty", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-28", { i: 1 });

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 1);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ i: 1 });
    });

    test("combines entries across two days in chronological order", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-28", { i: 1 });
      await adapter.appendJsonLine(dir, "2026-03-28", { i: 2 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 3 });

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 3);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ i: 1 });
      expect(result[1]).toEqual({ i: 2 });
      expect(result[2]).toEqual({ i: 3 });
    });

    test("respects maxDaysBack=0 (only reads today)", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-28", { i: 1 });

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 1, 0);
      expect(result).toEqual([]);
    });

    test("returns empty when no files exist in range", async () => {
      const adapter = createFilesystemAdapter();

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 5);
      expect(result).toEqual([]);
    });

    test("does not go beyond maxDaysBack", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-27", { i: 1 });

      const result = await adapter.readLastNLinesAcrossDays(dir, "2026-03-29", 1, 1);
      expect(result).toEqual([]);
    });
  });

  describe("readAllLinesForDay", () => {
    test("returns all entries for the given date", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-04-15", { i: 1 });
      await adapter.appendJsonLine(dir, "2026-04-15", { i: 2 });
      await adapter.appendJsonLine(dir, "2026-04-15", { i: 3 });
      const result = await adapter.readAllLinesForDay(dir, "2026-04-15");
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ i: 1 });
      expect(result[2]).toEqual({ i: 3 });
    });

    test("returns empty for missing file", async () => {
      const adapter = createFilesystemAdapter();
      const result = await adapter.readAllLinesForDay(dir, "2099-01-01");
      expect(result).toEqual([]);
    });
  });

  describe("readEntriesSince", () => {
    test("returns entries newer than sinceIso from single day", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T09:00:00.000Z", i: 1 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T10:00:00.000Z", i: 2 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T11:00:00.000Z", i: 3 });

      const result = await adapter.readEntriesSince(dir, "2026-04-15T09:30:00.000Z");
      expect(result).toHaveLength(2);
      expect((result[0] as { i: number }).i).toBe(2);
      expect((result[1] as { i: number }).i).toBe(3);
    });

    test("returns entries spanning multiple days", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-04-14", { timestamp: "2026-04-14T23:00:00.000Z", i: 1 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T01:00:00.000Z", i: 2 });

      const result = await adapter.readEntriesSince(dir, "2026-04-14T22:00:00.000Z");
      expect(result).toHaveLength(2);
      expect((result[0] as { i: number }).i).toBe(1);
      expect((result[1] as { i: number }).i).toBe(2);
    });

    test("returns empty when all entries are older", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T08:00:00.000Z", i: 1 });

      const result = await adapter.readEntriesSince(dir, "2026-04-15T09:00:00.000Z");
      expect(result).toEqual([]);
    });

    test("returns empty when no files exist", async () => {
      const adapter = createFilesystemAdapter();
      const result = await adapter.readEntriesSince(dir, "2026-04-15T09:00:00.000Z");
      expect(result).toEqual([]);
    });

    test("excludes entries exactly at sinceIso (strict >)", async () => {
      const adapter = createFilesystemAdapter();
      const exactTime = "2026-04-15T09:00:00.000Z";
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: exactTime, i: 1 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T10:00:00.000Z", i: 2 });

      const result = await adapter.readEntriesSince(dir, exactTime);
      expect(result).toHaveLength(1);
      expect((result[0] as { i: number }).i).toBe(2);
    });
  });

  describe("pruneEntriesBefore", () => {
    test("deletes older day files and trims the cutoff day", async () => {
      const adapter = createFilesystemAdapter() as ReturnType<typeof createFilesystemAdapter> & {
        pruneEntriesBefore(dir: string, beforeIso: string): Promise<void>;
      };

      await adapter.appendJsonLine(dir, "2026-04-14", { timestamp: "2026-04-14T23:00:00.000Z", i: 1 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T11:59:59.000Z", i: 2 });
      await adapter.appendJsonLine(dir, "2026-04-15", { timestamp: "2026-04-15T12:00:00.000Z", i: 3 });
      await adapter.appendJsonLine(dir, "2026-04-16", { timestamp: "2026-04-16T01:00:00.000Z", i: 4 });

      await adapter.pruneEntriesBefore(dir, "2026-04-15T12:00:00.000Z");

      expect(await Bun.file(join(dir, "2026-04-14.jsonl")).exists()).toBe(false);

      const cutoffDayEntries = await adapter.readAllLinesForDay(dir, "2026-04-15");
      expect(cutoffDayEntries).toEqual([{ timestamp: "2026-04-15T12:00:00.000Z", i: 3 }]);

      const newerDayEntries = await adapter.readAllLinesForDay(dir, "2026-04-16");
      expect(newerDayEntries).toEqual([{ timestamp: "2026-04-16T01:00:00.000Z", i: 4 }]);
    });
  });

  describe("readLastNLines", () => {
    test("returns empty array for non-existent file", async () => {
      const adapter = createFilesystemAdapter();
      const result = await adapter.readLastNLines(dir, "2026-01-01", 5);
      expect(result).toEqual([]);
    });

    test("returns last N parsed JSON objects", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 1 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 2 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 3 });
      await adapter.appendJsonLine(dir, "2026-03-29", { i: 4 });

      const result = await adapter.readLastNLines(dir, "2026-03-29", 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ i: 3 });
      expect(result[1]).toEqual({ i: 4 });
    });

    test("returns all lines when fewer than N exist", async () => {
      const adapter = createFilesystemAdapter();
      await adapter.appendJsonLine(dir, "2026-03-29", { only: "one" });

      const result = await adapter.readLastNLines(dir, "2026-03-29", 5);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ only: "one" });
    });

    test("skips empty lines", async () => {
      const adapter = createFilesystemAdapter();
      const filePath = join(dir, "2026-03-29.jsonl");
      await Bun.write(filePath, '{"a":1}\n\n{"b":2}\n\n');

      const result = await adapter.readLastNLines(dir, "2026-03-29", 5);
      expect(result).toHaveLength(2);
    });
  });
});
