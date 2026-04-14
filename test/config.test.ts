import { test, expect, describe } from "bun:test";
import { loadConfig } from "../src/config.ts";

const VALID_YAML = `
settings:
  webcamDevice: /dev/video2
  ollamaModel: llama3:8b
  ollamaBaseUrl: http://localhost:11434
  logDir: ./my-logs
  captureDir: ./my-captures
  captureWidth: 1280
  captureHeight: 720
  actionHistoryCount: 20

actions:
  none:
    active: false
  nudge_break:
    active: true
    description: "Suggest the user take a short break"
    fallback:
      body: "Consider standing up and stretching."
  nudge_sleep:
    active: true
    description: "Suggest the user go to sleep"
    fallback:
      body: "Consider wrapping up and heading to bed."
`;

const MINIMAL_YAML = `
actions:
  none:
    active: false
`;

const CUSTOM_ACTION_YAML = `
actions:
  none:
    active: false
  nudge_hydrate:
    active: true
    description: "Remind the user to drink water"
    fallback:
      body: "Time to drink some water."
  nudge_posture:
    active: true
    description: "Remind the user to check posture"
    fallback:
      body: "Sit up straight and relax your shoulders."
`;

describe("loadConfig", () => {
  describe("settings", () => {
    test("parses full settings from YAML", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.settings.webcamDevice).toBe("/dev/video2");
      expect(config.settings.ollamaModel).toBe("llama3:8b");
      expect(config.settings.logDir).toBe("./my-logs");
      expect(config.settings.captureWidth).toBe(1280);
      expect(config.settings.actionHistoryCount).toBe(20);
    });

    test("applies defaults for missing settings", () => {
      const config = loadConfig(MINIMAL_YAML);
      expect(config.settings.webcamDevice).toBe("/dev/video0");
      expect(config.settings.ollamaModel).toBe("gemma3:12b");
      expect(config.settings.logDir).toBe("./logs");
      expect(config.settings.captureDir).toBe("./captures");
      expect(config.settings.captureWidth).toBe(640);
      expect(config.settings.captureHeight).toBe(480);
      expect(config.settings.actionHistoryCount).toBe(10);
    });

    test("responseStyle defaults to English friendly phrase", () => {
      const config = loadConfig(MINIMAL_YAML);
      expect(config.settings.responseStyle).toBe("English, friendly and concise");
    });

    test("responseStyle is parsed from YAML verbatim", () => {
      const yaml = `
settings:
  responseStyle: "日本語、丁寧で優しい口調"
actions:
  none:
    active: false
`;
      const config = loadConfig(yaml);
      expect(config.settings.responseStyle).toBe("日本語、丁寧で優しい口調");
    });

    test("actionDigestDays and digestContextDays are not present in settings", () => {
      const config = loadConfig(MINIMAL_YAML);
      expect((config.settings as Record<string, unknown>).actionDigestDays).toBeUndefined();
      expect((config.settings as Record<string, unknown>).digestContextDays).toBeUndefined();
    });

    test("rejects invalid ollamaBaseUrl", () => {
      const yaml = `
settings:
  ollamaBaseUrl: not-a-url
actions:
  none:
    active: false
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

  });

  describe("actions", () => {
    test("parses actions with all fields", () => {
      const config = loadConfig(VALID_YAML);
      expect(Object.keys(config.actions)).toEqual([
        "none", "nudge_break", "nudge_sleep",
      ]);
      expect(config.actions.nudge_break!.active).toBe(true);
      expect(config.actions.nudge_break!.description).toBe("Suggest the user take a short break");
      expect(config.actions.nudge_break!.fallback).toEqual({
        body: "Consider standing up and stretching.",
      });
    });

    test("parses custom actions", () => {
      const config = loadConfig(CUSTOM_ACTION_YAML);
      expect(Object.keys(config.actions)).toContain("nudge_hydrate");
      expect(Object.keys(config.actions)).toContain("nudge_posture");
      expect(config.actions.nudge_hydrate!.active).toBe(true);
      expect(config.actions.nudge_hydrate!.fallback!.body).toBe("Time to drink some water.");
    });

    test("rejects config without none action", () => {
      const yaml = `
actions:
  nudge_break:
    active: true
    fallback:
      body: b
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

    test("rejects config with no actions", () => {
      expect(() => loadConfig(`actions: {}`)).toThrow();
    });

    test("rejects active action without fallback", () => {
      const yaml = `
actions:
  none:
    active: false
  nudge_break:
    active: true
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

    test("allows passive action without fallback", () => {
      const config = loadConfig(MINIMAL_YAML);
      expect(config.actions.none!.fallback).toBeUndefined();
    });
  });

  describe("helpers", () => {
    test("getActionNames returns all action names", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getActionNames()).toEqual(["none", "nudge_break", "nudge_sleep"]);
    });

    test("getActiveActions returns only active actions", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getActiveActions()).toEqual(["nudge_break", "nudge_sleep"]);
    });

    test("getPassiveActions returns only passive actions", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getPassiveActions()).toEqual(["none"]);
    });

    test("getFallbackMessage returns fallback for active action", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getFallbackMessage("nudge_break")).toEqual({
        body: "Consider standing up and stretching.",
      });
    });

    test("getFallbackMessage returns undefined for passive action", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getFallbackMessage("none")).toBeUndefined();
    });

    test("getDescription returns description string", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getDescription("nudge_break")).toBe("Suggest the user take a short break");
    });

    test("isActiveAction checks correctly", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.isActiveAction("nudge_break")).toBe(true);
      expect(config.isActiveAction("none")).toBe(false);
      expect(config.isActiveAction("unknown_action")).toBe(false);
    });

    test("works with custom actions", () => {
      const config = loadConfig(CUSTOM_ACTION_YAML);
      expect(config.getActiveActions()).toEqual(["nudge_hydrate", "nudge_posture"]);
      expect(config.getPassiveActions()).toEqual(["none"]);
      expect(config.getFallbackMessage("nudge_hydrate")).toEqual({
        body: "Time to drink some water.",
      });
    });
  });
});
