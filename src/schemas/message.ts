import { z } from "zod/v4";

export const DraftMessageSchema = z.object({
  body: z.string().min(1),
});

export type DraftMessage = z.infer<typeof DraftMessageSchema>;
