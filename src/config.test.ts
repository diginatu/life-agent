import { test, expect } from "bun:test";
import { loadConfig } from "./config.ts";

const minimalYaml = `
actions:
  none:
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
`;
  const config = loadConfig(yaml);
  expect(config.settings.webPort).toBe(8080);
});

test("discordChannelId defaults to empty string", () => {
  const config = loadConfig(minimalYaml);
  expect(config.settings.discordChannelId).toBe("");
});

test("l2MaxRetention defaults to 48", () => {
  const config = loadConfig(minimalYaml);
  expect(config.settings.l2MaxRetention).toBe(48);
});

test("l3MaxRetention defaults to 28", () => {
  const config = loadConfig(minimalYaml);
  expect(config.settings.l3MaxRetention).toBe(28);
});

test("discordChannelId is parsed from YAML", () => {
  const yaml = `
settings:
  discordChannelId: "123456789"
actions:
  none:
    active: false
`;
  const config = loadConfig(yaml);
  expect(config.settings.discordChannelId).toBe("123456789");
});

