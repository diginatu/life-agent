import { z } from "zod/v4";

export const ActionSelectionSchema = z.object({
  action: z.string(),
  reason: z.string(),
});

export type ActionSelection = z.infer<typeof ActionSelectionSchema>;
