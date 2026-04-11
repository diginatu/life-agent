import { loadConfig } from "../../src/config.ts";
import { stringify as yamlStringify } from "yaml";

const DEFAULT_ACTIONS: Record<string, Record<string, unknown>> = {
  none: { active: false },
  nudge_break: {
    active: true,
    description: "Suggest the user take a short break",
    fallback: {
      title: "Time for a break",
      body: "You've been working for a while. Consider standing up and stretching.",
    },
  },
  nudge_sleep: {
    active: true,
    description: "Suggest the user go to sleep",
    fallback: {
      title: "Time to wind down",
      body: "It's getting late. Consider wrapping up and heading to bed.",
    },
  },
};

export function mockActionsConfig(
  actionOverrides: Record<string, Record<string, unknown>> = {},
  settingsOverrides: Record<string, unknown> = {},
) {
  const actions = { ...DEFAULT_ACTIONS };
  for (const [name, overrides] of Object.entries(actionOverrides)) {
    actions[name] = { ...actions[name], ...overrides };
  }
  const doc: Record<string, unknown> = { actions };
  if (Object.keys(settingsOverrides).length > 0) {
    doc.settings = settingsOverrides;
  }
  const yaml = yamlStringify(doc);
  return loadConfig(yaml);
}
