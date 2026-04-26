import { z } from "zod/v4";

export const PlanItemSchema = z.object({
  time: z.string().min(1),
  action: z.string().min(1),
  reason: z.string().min(1),
});

export const PlanSchema = z.object({
  generatedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  items: z.array(PlanItemSchema).min(1),
});

export type Plan = z.infer<typeof PlanSchema>;
