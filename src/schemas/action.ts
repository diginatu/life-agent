import { z } from "zod/v4";

export const ActionEnum = z.enum(["none", "log_only", "nudge_break", "nudge_sleep"]);
export type Action = z.infer<typeof ActionEnum>;

export const PriorityEnum = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const ActionSelectionSchema = z.object({
  action: ActionEnum,
  priority: PriorityEnum,
  reason: z.string(),
});

export type ActionSelection = z.infer<typeof ActionSelectionSchema>;
