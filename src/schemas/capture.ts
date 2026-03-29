import { z } from "zod/v4";

export const CaptureResultSchema = z.object({
  imagePath: z.string().min(1),
  timestamp: z.iso.datetime(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type CaptureResult = z.infer<typeof CaptureResultSchema>;
