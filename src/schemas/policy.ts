import { z } from "zod/v4";

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  cooldownBlocked: z.boolean(),
  quietHoursBlocked: z.boolean(),
  reasons: z.array(z.string()),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
