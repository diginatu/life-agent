import { z } from "zod/v4";
import { CaptureResultSchema } from "./capture.ts";
import { SceneSummarySchema } from "./summary.ts";
import { ActionSelectionSchema } from "./action.ts";
import { DraftMessageSchema } from "./message.ts";

export const LogEntrySchema = z.object({
  eventId: z.string().min(1),
  timestamp: z.iso.datetime(),
  capture: CaptureResultSchema,
  summary: SceneSummarySchema,
  policy: z.unknown().nullable(),
  decision: ActionSelectionSchema,
  message: DraftMessageSchema.nullable(),
  errors: z.array(z.string()),
  tags: z.array(z.string()),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;
