import { z } from "zod/v4";
import { parse as parseYaml } from "yaml";

const SettingsSchema = z.object({
  webcamDevice: z.string().default("/dev/video0"),
  ollamaModel: z.string().default("gemma3:12b"),
  ollamaBaseUrl: z.url().default("http://localhost:11434"),
  logDir: z.string().default("./logs"),
  captureDir: z.string().default("./captures"),
  captureWidth: z.number().int().positive().default(640),
  captureHeight: z.number().int().positive().default(480),
  captureRetentionCount: z.number().int().positive().default(10),
  actionHistoryCount: z.number().int().nonnegative().default(10),
  memoryDir: z.string().default("./memory"),
  webPort: z.number().int().positive().default(3000),
  discordChannelId: z.string().default(""),
  discordMentionUserId: z.string().default(""),
  responseStyle: z.string().default("English, friendly and concise"),
  l2DelayHours: z.number().int().nonnegative().default(1),
  l3DelayHours: z.number().int().nonnegative().default(6),
});

export type Settings = z.infer<typeof SettingsSchema>;

const FallbackMessageSchema = z.object({
  body: z.string().min(1),
});

const ActionDefinitionSchema = z.object({
  active: z.boolean(),
  description: z.string().optional(),
  fallback: FallbackMessageSchema.optional(),
});

const RawConfigSchema = z.object({
  settings: SettingsSchema.optional(),
  actions: z.record(z.string(), ActionDefinitionSchema),
});

export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

export interface Config {
  settings: Settings;
  actions: Record<string, ActionDefinition>;
  getActionNames(): string[];
  getActiveActions(): string[];
  getPassiveActions(): string[];
  getFallbackMessage(action: string): { body: string } | undefined;
  getDescription(action: string): string | undefined;
  isActiveAction(action: string): boolean;
}

function validate(raw: z.infer<typeof RawConfigSchema>): void {
  if (!("none" in raw.actions)) {
    throw new Error("Config must include a 'none' action");
  }
  for (const [name, def] of Object.entries(raw.actions)) {
    if (def.active && !def.fallback) {
      throw new Error(`Active action '${name}' must have a fallback message`);
    }
  }
}

export function loadConfig(yamlContent: string): Config {
  const parsed = parseYaml(yamlContent);
  const raw = RawConfigSchema.parse(parsed);
  const settings = SettingsSchema.parse(raw.settings ?? {});
  validate(raw);

  return {
    settings,
    actions: raw.actions,

    getActionNames() {
      return Object.keys(raw.actions);
    },

    getActiveActions() {
      return Object.keys(raw.actions).filter((k) => raw.actions[k]!.active);
    },

    getPassiveActions() {
      return Object.keys(raw.actions).filter((k) => !raw.actions[k]!.active);
    },

    getFallbackMessage(action: string) {
      return raw.actions[action]?.fallback;
    },

    getDescription(action: string) {
      return raw.actions[action]?.description;
    },

    isActiveAction(action: string) {
      return raw.actions[action]?.active === true;
    },

  };
}

export async function loadConfigFromFile(path: string): Promise<Config> {
  const file = Bun.file(path);
  const content = await file.text();
  return loadConfig(content);
}
