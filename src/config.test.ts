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

