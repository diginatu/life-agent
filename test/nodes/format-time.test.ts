import { expect, test } from "bun:test";
import { formatLocalDateTime, formatTime, formatTimeOfDay } from "../../src/nodes/format-time.ts";

test("formatTimeOfDay renders local 12-hour time", () => {
  const d = new Date(2026, 3, 18, 14, 5, 6);
  expect(formatTimeOfDay(d)).toBe("02:05 PM");
});

test("formatLocalDateTime renders local compact datetime", () => {
  const d = new Date(2026, 3, 18, 14, 5, 6);
  expect(formatLocalDateTime(d)).toBe("2026-04-18T14:05:06");
});

test("formatTime keeps day/date and am-pm format", () => {
  const d = new Date(2026, 3, 18, 14, 5, 6);
  expect(formatTime(d)).toBe("Saturday, 2026-04-18 02:05 PM");
});
