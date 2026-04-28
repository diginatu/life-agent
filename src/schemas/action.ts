import { z } from "zod/v4";

export const ActionSelectionSchema = z
  .object({
    actions: z.array(z.string()).min(1),
    reason: z.string(),
  })
  .refine((value) => new Set(value.actions).size === value.actions.length, {
    path: ["actions"],
    message: "actions must be unique",
  })
  .refine((value) => {
    if (!value.actions.includes("none")) return true;
    return value.actions.length === 1;
  }, {
    path: ["actions"],
    message: '"none" cannot be combined with other actions',
  });

export type ActionSelection = z.infer<typeof ActionSelectionSchema>;
