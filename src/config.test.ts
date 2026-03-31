import { test, expect } from "bun:test";
import { loadConfig } from "./config.ts";

const minimalYaml = `
actions:
  none:
    active: false
  log_only:
    active: false
`;

test("webPort defaults to 3000 when not specified", () => {
  const config = loadConfig(minimalYaml);
  expect(config.settings.webPort).toBe(3000);
});

test("webPort is parsed correctly when specified in YAML", () => {
  const yaml = `
settings:
  webPort: 8080
actions:
  none:
    active: false
  log_only:
    active: false
`;
  const config = loadConfig(yaml);
  expect(config.settings.webPort).toBe(8080);
});

test("action-specific cooldownMinutes is parsed", () => {
  const yaml = `
actions:
  none:
    active: false
  log_only:
    active: false
  nudge_break:
    active: true
    cooldownMinutes: 15
    fallback:
      title: Break
      body: Take a break
`;
  const config = loadConfig(yaml);
  expect(config.actions.nudge_break.cooldownMinutes).toBe(15);
});

test("getCooldownMinutes returns action-specific value", () => {
  const yaml = `
settings:
  cooldownMinutes: 30
actions:
  none:
    active: false
  log_only:
    active: false
  nudge_break:
    active: true
    cooldownMinutes: 15
    fallback:
      title: Break
      body: Take a break
`;
  const config = loadConfig(yaml);
  expect(config.getCooldownMinutes("nudge_break")).toBe(15);
});

test("discordEnabled defaults to false", () => {
  const config = loadConfig(minimalYaml);
  expect(config.settings.discordEnabled).toBe(false);
});

test("discordEnabled and discordChannelId are parsed from YAML", () => {
  const yaml = `
settings:
  discordEnabled: true
  discordChannelId: "123456789"
actions:
  none:
    active: false
  log_only:
    active: false
`;
  const config = loadConfig(yaml);
  expect(config.settings.discordEnabled).toBe(true);
  expect(config.settings.discordChannelId).toBe("123456789");
});

test("getCooldownMinutes falls back to global when action has no specific value", () => {
  const yaml = `
settings:
  cooldownMinutes: 30
actions:
  none:
    active: false
  log_only:
    active: false
  nudge_sleep:
    active: true
    fallback:
      title: Sleep
      body: Go to sleep
`;
  const config = loadConfig(yaml);
  expect(config.getCooldownMinutes("nudge_sleep")).toBe(30);
});
