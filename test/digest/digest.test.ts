import { test, expect, describe } from "bun:test";
import { buildStats, generateDigest } from "../../src/digest/generate.ts";
import { runDigest, shouldRunDigest, writeDigestMarker } from "../../src/digest/cli.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";
import type { DiscordAdapter } from "../../src/adapters/discord.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";
import { mockActionsConfig } from "../helpers/mock-config.ts";

const sampleEntries = [
  {
    eventId: "1",
    timestamp: "2026-03-29T09:00:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.9 },
    decision: { action: "log_only", priority: "low", reason: "routine" },
    message: null,
    errors: [],
  },
  {
    eventId: "2",
    timestamp: "2026-03-29T09:15:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.85 },
    decision: { action: "log_only", priority: "low", reason: "duplicate" },
    message: null,
    errors: [],
  },
  {
    eventId: "3",
    timestamp: "2026-03-29T10:00:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.8 },
    decision: { action: "nudge_break", priority: "medium", reason: "long session" },
    message: { title: "Break time!", body: "Stand up and stretch." },
    errors: [],
  },
  {
    eventId: "4",
    timestamp: "2026-03-29T12:00:00.000Z",
    summary: { personPresent: false, posture: "unknown", scene: "empty desk", activityGuess: null, confidence: 0.7 },
    decision: { action: "none", priority: "low", reason: "no one present" },
    message: null,
    errors: [],
  },
  {
    eventId: "5",
    timestamp: "2026-03-29T14:00:00.000Z",
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "reading", confidence: 0.75 },
    decision: { action: "log_only", priority: "low", reason: "different activity" },
    message: null,
    errors: ["summarize: ollama timeout"],
  },
];

describe("buildStats", () => {
  test("counts actions correctly", () => {
    const stats = buildStats(sampleEntries);
    expect(stats.actionCounts.log_only).toBe(3);
    expect(stats.actionCounts.nudge_break).toBe(1);
    expect(stats.actionCounts.none).toBe(1);
  });

  test("computes time range", () => {
    const stats = buildStats(sampleEntries);
    expect(stats.firstTimestamp).toBe("2026-03-29T09:00:00.000Z");
    expect(stats.lastTimestamp).toBe("2026-03-29T14:00:00.000Z");
  });

  test("counts entries and errors", () => {
    const stats = buildStats(sampleEntries);
    expect(stats.totalEntries).toBe(5);
    expect(stats.errorCount).toBe(1);
  });

  test("finds most common activity", () => {
    const stats = buildStats(sampleEntries);
    expect(stats.topActivity).toBe("coding");
  });

  test("counts notifications sent", () => {
    const stats = buildStats(sampleEntries);
    expect(stats.notificationCount).toBe(1);
  });

  test("handles empty entries", () => {
    const stats = buildStats([]);
    expect(stats.totalEntries).toBe(0);
    expect(stats.actionCounts).toEqual({});
    expect(stats.firstTimestamp).toBeUndefined();
    expect(stats.lastTimestamp).toBeUndefined();
    expect(stats.topActivity).toBeUndefined();
    expect(stats.notificationCount).toBe(0);
    expect(stats.errorCount).toBe(0);
  });
});

describe("generateDigest", () => {
  test("generates markdown with LLM", async () => {
    const mockOllama: OllamaAdapter = {
      generate: async () => "## Daily Summary\n\nYou spent most of the day coding at your desk.",
      generateWithImage: async () => "",
    };
    const result = await generateDigest(sampleEntries, "2026-03-29", mockOllama);

    expect(result).toContain("Daily Summary");
    expect(result).toContain("coding");
  });

  test("falls back to stats-only on LLM error", async () => {
    const errorOllama: OllamaAdapter = {
      generate: async () => { throw new Error("ollama down"); },
      generateWithImage: async () => { throw new Error("ollama down"); },
    };
    const result = await generateDigest(sampleEntries, "2026-03-29", errorOllama);

    expect(result).toContain("2026-03-29");
    expect(result).toContain("5"); // total entries
    expect(result).toContain("log_only");
    expect(result).toContain("nudge_break");
  });

  test("handles empty log", async () => {
    const mockOllama: OllamaAdapter = {
      generate: async () => "No activity recorded.",
      generateWithImage: async () => "",
    };
    const result = await generateDigest([], "2026-03-29", mockOllama);

    expect(result).toContain("No activity");
  });

  test("includes stats in LLM prompt", async () => {
    let capturedPrompt = "";
    const capturingOllama: OllamaAdapter = {
      generate: async (prompt) => {
        capturedPrompt = prompt;
        return "## Summary";
      },
      generateWithImage: async () => "",
    };
    await generateDigest(sampleEntries, "2026-03-29", capturingOllama);

    expect(capturedPrompt).toContain("coding");
    expect(capturedPrompt).toContain("nudge_break");
    expect(capturedPrompt).toContain("5"); // total entries
  });
});

describe("runDigest with Discord", () => {
  const config = mockActionsConfig();

  function mockOllama(): OllamaAdapter {
    return {
      generate: async () => "## Daily Summary\n\nA productive day of coding.",
      generateWithImage: async () => "",
    };
  }

  function mockFs(): FilesystemAdapter {
    return {
      appendJsonLine: async () => {},
      readLastNLines: async () => sampleEntries,
    };
  }

  function mockDiscord(): DiscordAdapter & { embeds: Array<{ title: string; body: string }> } {
    const embeds: Array<{ title: string; body: string }> = [];
    return {
      embeds,
      sendEmbed: async (title: string, body: string) => {
        embeds.push({ title, body });
        return "discord-msg-1";
      },
      collectReplies: async () => [],
      destroy: async () => {},
    };
  }

  test("sends digest to Discord when adapter is provided", async () => {
    const discord = mockDiscord();
    await runDigest(config, "2026-03-29", {
      fs: mockFs(),
      ollama: mockOllama(),
      discord,
    });

    expect(discord.embeds.length).toBe(1);
    expect(discord.embeds[0]!.title).toContain("2026-03-29");
    expect(discord.embeds[0]!.body).toContain("Daily Summary");
  });

  test("works without Discord adapter", async () => {
    await runDigest(config, "2026-03-29", {
      fs: mockFs(),
      ollama: mockOllama(),
    });
    // No error thrown
  });

  test("writes digest marker after sending", async () => {
    const written: unknown[] = [];
    const fs: FilesystemAdapter = {
      appendJsonLine: async (_dir, _date, data) => { written.push(data); },
      readLastNLines: async () => sampleEntries,
    };
    await runDigest(config, "2026-03-29", { fs, ollama: mockOllama() });

    const marker = written.find((e) => {
      const entry = e as Record<string, unknown>;
      return (entry.tags as string[])?.includes("digest");
    }) as Record<string, unknown> | undefined;
    expect(marker).toBeDefined();
    expect(marker!.digestDate).toBe("2026-03-29");
  });
});

describe("shouldRunDigest", () => {
  const now = new Date("2026-03-31T10:00:00.000Z");

  test("returns true when no digest marker in log", async () => {
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        { timestamp: "2026-03-31T09:00:00.000Z", tags: [], decision: { action: "log_only" } },
      ],
    };
    expect(await shouldRunDigest(fs, "./logs", now)).toBe(true);
  });

  test("returns false when digest marker exists within 24h", async () => {
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        { timestamp: "2026-03-31T08:00:00.000Z", tags: ["digest"], digestDate: "2026-03-30" },
      ],
    };
    expect(await shouldRunDigest(fs, "./logs", now)).toBe(false);
  });

  test("returns true when digest marker is older than 24h", async () => {
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [
        { timestamp: "2026-03-30T09:00:00.000Z", tags: ["digest"], digestDate: "2026-03-29" },
      ],
    };
    expect(await shouldRunDigest(fs, "./logs", now)).toBe(true);
  });

  test("returns true when log is empty", async () => {
    const fs: FilesystemAdapter = {
      appendJsonLine: async () => {},
      readLastNLines: async () => [],
    };
    expect(await shouldRunDigest(fs, "./logs", now)).toBe(true);
  });
});

describe("writeDigestMarker", () => {
  test("writes entry with digest tag and digestDate", async () => {
    const written: unknown[] = [];
    const fs: FilesystemAdapter = {
      appendJsonLine: async (_dir, _date, data) => { written.push(data); },
      readLastNLines: async () => [],
    };
    const now = new Date("2026-03-31T10:00:00.000Z");
    await writeDigestMarker(fs, "./logs", "2026-03-30", now);

    expect(written.length).toBe(1);
    const entry = written[0] as Record<string, unknown>;
    expect((entry.tags as string[])).toContain("digest");
    expect(entry.digestDate).toBe("2026-03-30");
    expect(entry.timestamp).toBe("2026-03-31T10:00:00.000Z");
    expect(entry.eventId).toBeDefined();
  });

  test("includes digest content when provided", async () => {
    const written: unknown[] = [];
    const fs: FilesystemAdapter = {
      appendJsonLine: async (_dir, _date, data) => { written.push(data); },
      readLastNLines: async () => [],
    };
    const now = new Date("2026-03-31T10:00:00.000Z");
    const content = "## Daily Summary\n\nA productive day.";
    await writeDigestMarker(fs, "./logs", "2026-03-30", now, content);

    const entry = written[0] as Record<string, unknown>;
    expect(entry.content).toBe(content);
  });
});

describe("runDigest persists digest content", () => {
  const config = mockActionsConfig();

  test("writes digest markdown content to log marker", async () => {
    const digestMarkdown = "## Daily Summary\n\nA productive day of coding.";
    const written: unknown[] = [];
    const fs: FilesystemAdapter = {
      appendJsonLine: async (_dir, _date, data) => { written.push(data); },
      readLastNLines: async () => sampleEntries,
    };
    const ollama: OllamaAdapter = {
      generate: async () => digestMarkdown,
      generateWithImage: async () => "",
    };
    await runDigest(config, "2026-03-29", { fs, ollama });

    const marker = written.find((e) => {
      const entry = e as Record<string, unknown>;
      return (entry.tags as string[])?.includes("digest");
    }) as Record<string, unknown> | undefined;
    expect(marker).toBeDefined();
    expect(marker!.content).toBe(digestMarkdown);
  });
});
