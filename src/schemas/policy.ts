import { z } from "zod/v4";
import { ActionEnum } from "./action.ts";

export const PolicyDecisionSchema = z.object({
  availableActions: z.array(ActionEnum).min(1),
  cooldownBlocked: z.boolean(),
  quietHoursBlocked: z.boolean(),
  reasons: z.array(z.string()),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
