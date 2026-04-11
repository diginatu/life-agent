import { test, expect, describe } from "bun:test";
import { CaptureResultSchema } from "../src/schemas/capture.ts";
import { SceneSummarySchema } from "../src/schemas/summary.ts";
import { ActionSelectionSchema } from "../src/schemas/action.ts";
import { DraftMessageSchema } from "../src/schemas/message.ts";
import { LogEntrySchema } from "../src/schemas/log-entry.ts";

describe("CaptureResultSchema", () => {
  test("accepts valid capture result", () => {
    const result = CaptureResultSchema.parse({
      imagePath: "captures/2026-03-29T12-00-00.jpg",
      timestamp: "2026-03-29T12:00:00.000Z",
      width: 640,
      height: 480,
    });
    expect(result.imagePath).toBe("captures/2026-03-29T12-00-00.jpg");
    expect(result.width).toBe(640);
  });

  test("rejects missing imagePath", () => {
    expect(() =>
      CaptureResultSchema.parse({
        timestamp: "2026-03-29T12:00:00.000Z",
        width: 640,
        height: 480,
      })
    ).toThrow();
  });

  test("rejects negative width", () => {
    expect(() =>
      CaptureResultSchema.parse({
        imagePath: "test.jpg",
        timestamp: "2026-03-29T12:00:00.000Z",
        width: -1,
        height: 480,
      })
    ).toThrow();
  });
});

describe("SceneSummarySchema", () => {
  test("accepts valid summary", () => {
    const result = SceneSummarySchema.parse({
      personPresent: true,
      posture: "sitting",
      scene: "desk with monitor and keyboard",
      activityGuess: "coding",
      confidence: 0.85,
    });
    expect(result.personPresent).toBe(true);
    expect(result.confidence).toBe(0.85);
  });

  test("accepts null activityGuess", () => {
    const result = SceneSummarySchema.parse({
      personPresent: false,
      posture: "unknown",
      scene: "empty room",
      activityGuess: null,
      confidence: 0.2,
    });
    expect(result.activityGuess).toBeNull();
  });

  test("rejects confidence above 1", () => {
    expect(() =>
      SceneSummarySchema.parse({
        personPresent: true,
        posture: "standing",
        scene: "kitchen",
        activityGuess: "cooking",
        confidence: 1.5,
      })
    ).toThrow();
  });

  test("accepts confidence at boundaries (0 and 1)", () => {
    const at0 = SceneSummarySchema.parse({
      personPresent: false,
      posture: "unknown",
      scene: "dark",
      activityGuess: null,
      confidence: 0,
    });
    expect(at0.confidence).toBe(0);

    const at1 = SceneSummarySchema.parse({
      personPresent: true,
      posture: "sitting",
      scene: "desk",
      activityGuess: "typing",
      confidence: 1,
    });
    expect(at1.confidence).toBe(1);
  });
});

describe("ActionSelectionSchema", () => {
  test("accepts valid action selection", () => {
    const result = ActionSelectionSchema.parse({
      action: "nudge_break",
      priority: "low",
      reason: "user sitting for 2 hours",
    });
    expect(result.action).toBe("nudge_break");
  });

  test("rejects invalid priority", () => {
    expect(() =>
      ActionSelectionSchema.parse({
        action: "nudge_break",
        priority: "critical",
        reason: "test",
      })
    ).toThrow();
  });
});

describe("DraftMessageSchema", () => {
  test("accepts valid message", () => {
    const result = DraftMessageSchema.parse({
      title: "Time for a break!",
      body: "You've been working for a while. Stand up and stretch.",
    });
    expect(result.title).toBe("Time for a break!");
  });

  test("rejects empty title", () => {
    expect(() =>
      DraftMessageSchema.parse({
        title: "",
        body: "some body",
      })
    ).toThrow();
  });
});

describe("LogEntrySchema", () => {
  const validEntry = {
    eventId: "550e8400-e29b-41d4-a716-446655440000",
    timestamp: "2026-03-29T12:00:00.000Z",
    capture: {
      imagePath: "captures/test.jpg",
      timestamp: "2026-03-29T12:00:00.000Z",
      width: 640,
      height: 480,
    },
    summary: {
      personPresent: true,
      posture: "sitting",
      scene: "desk",
      activityGuess: "coding",
      confidence: 0.8,
    },
    policy: null,
    decision: {
      action: "none" as const,
      priority: "low" as const,
      reason: "routine logging",
    },
    message: null,
    errors: [],
    tags: ["routine"],
  };

  test("accepts valid full log entry", () => {
    const result = LogEntrySchema.parse(validEntry);
    expect(result.eventId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(result.message).toBeNull();
  });

  test("accepts log entry with message", () => {
    const withMessage = {
      ...validEntry,
      decision: { action: "nudge_break" as const, priority: "medium" as const, reason: "long session" },
      message: { title: "Break time", body: "Take a walk" },
    };
    const result = LogEntrySchema.parse(withMessage);
    expect(result.message?.title).toBe("Break time");
  });

  test("accepts log entry with errors", () => {
    const withErrors = {
      ...validEntry,
      errors: ["ollama timeout", "parse failed"],
    };
    const result = LogEntrySchema.parse(withErrors);
    expect(result.errors).toHaveLength(2);
  });

  test("rejects missing required fields", () => {
    expect(() => LogEntrySchema.parse({ eventId: "test" })).toThrow();
  });
});
