import { z } from "zod/v4";

export const PolicyDecisionSchema = z.object({
  availableActions: z.array(z.string()).min(1),
  cooldownBlocked: z.boolean(),
  quietHoursBlocked: z.boolean(),
  reasons: z.array(z.string()),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
