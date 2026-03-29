import { z } from "zod/v4";

const ConfigSchema = z.object({
  webcamDevice: z.string().default("/dev/video0"),
  ollamaModel: z.string().default("gemma3:12b"),
  ollamaBaseUrl: z.url().default("http://localhost:11434"),
  logDir: z.string().default("./logs"),
  captureDir: z.string().default("./captures"),
  captureWidth: z.coerce.number().int().positive().default(640),
  captureHeight: z.coerce.number().int().positive().default(480),
  quietHoursStart: z.coerce.number().int().min(0).max(23).default(23),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).default(7),
  cooldownMinutes: z.coerce.number().int().positive().default(30),
  confidenceThreshold: z.coerce.number().min(0).max(1).default(0.3),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    webcamDevice: process.env.WEBCAM_DEVICE,
    ollamaModel: process.env.OLLAMA_MODEL,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    logDir: process.env.LOG_DIR,
    captureDir: process.env.CAPTURE_DIR,
    captureWidth: process.env.CAPTURE_WIDTH,
    captureHeight: process.env.CAPTURE_HEIGHT,
    quietHoursStart: process.env.QUIET_HOURS_START,
    quietHoursEnd: process.env.QUIET_HOURS_END,
    cooldownMinutes: process.env.COOLDOWN_MINUTES,
    confidenceThreshold: process.env.CONFIDENCE_THRESHOLD,
  });
}
