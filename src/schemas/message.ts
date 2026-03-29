import { z } from "zod/v4";

export const DraftMessageSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});

export type DraftMessage = z.infer<typeof DraftMessageSchema>;
