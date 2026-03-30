import { z } from "zod/v4";

export const PriorityEnum = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const ActionSelectionSchema = z.object({
  action: z.string(),
  priority: PriorityEnum,
  reason: z.string(),
});

export type ActionSelection = z.infer<typeof ActionSelectionSchema>;
