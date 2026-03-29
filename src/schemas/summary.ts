import { z } from "zod/v4";

export const SceneSummarySchema = z.object({
  personPresent: z.boolean(),
  posture: z.string(),
  scene: z.string(),
  activityGuess: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type SceneSummary = z.infer<typeof SceneSummarySchema>;
