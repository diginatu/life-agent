import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createServer } from "../../src/web/server.ts";
import type { FilesystemAdapter } from "../../src/adapters/filesystem.ts";

const sampleEntries = [
  {
    eventId: "1",
    timestamp: "2026-03-29T09:00:00.000Z",
    decision: { action: "none", priority: "low", reason: "routine" },
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.9 },
    message: null,
    errors: [],
  },
  {
    eventId: "2",
    timestamp: "2026-03-29T10:00:00.000Z",
    decision: { action: "nudge_break", priority: "medium", reason: "long session" },
    summary: { personPresent: true, posture: "sitting", scene: "desk", activityGuess: "coding", confidence: 0.85 },
    message: { body: "Stand up — long session." },
    errors: [],
  },
];

function mockFs(entries: unknown[] = sampleEntries): FilesystemAdapter {
  return {
    appendJsonLine: async () => {},
    readLastNLines: async () => entries,
    readLastNLinesAcrossDays: async () => entries,
  };
}

describe("web server", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer({ fs: mockFs(), port: 0 });
    baseUrl = `http://${server.hostname}:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /api/log/:date returns JSON array of entries", async () => {
    const res = await fetch(`${baseUrl}/api/log/2026-03-29`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json() as { length: number; [key: number]: { eventId: string } };
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0]!.eventId).toBe("1");
  });

  test("GET /api/log/:date returns empty array when no entries", async () => {
    const emptyServer = createServer({ fs: mockFs([]), port: 0 });
    const url = `http://${emptyServer.hostname}:${emptyServer.port}`;
    try {
      const res = await fetch(`${url}/api/log/2026-01-01`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    } finally {
      emptyServer.stop();
    }
  });

  test("GET / returns HTML", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Life Agent");
  });
});
