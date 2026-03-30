import { loadConfig } from "../../src/config.ts";

const DEFAULT_CONFIG_YAML = `
actions:
  none:
    active: false
  log_only:
    active: false
  nudge_break:
    active: true
    description: "Suggest the user take a short break"
    fallback:
      title: "Time for a break"
      body: "You've been working for a while. Consider standing up and stretching."
  nudge_sleep:
    active: true
    description: "Suggest the user go to sleep"
    fallback:
      title: "Time to wind down"
      body: "It's getting late. Consider wrapping up and heading to bed."
`;

export function mockActionsConfig() {
  return loadConfig(DEFAULT_CONFIG_YAML);
}
