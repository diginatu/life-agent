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
  quietHoursStart: 22
  quietHoursEnd: 6
  cooldownMinutes: 15
  confidenceThreshold: 0.5
  actionHistoryCount: 20
  policyHistoryCount: 8
  actionDigestDays: 3

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
      body: "Consider standing up and stretching."
  nudge_sleep:
    active: true
    description: "Suggest the user go to sleep"
    fallback:
      title: "Time to wind down"
      body: "Consider wrapping up and heading to bed."
`;

const MINIMAL_YAML = `
actions:
  none:
    active: false
  log_only:
    active: false
`;

const CUSTOM_ACTION_YAML = `
actions:
  none:
    active: false
  log_only:
    active: false
  nudge_hydrate:
    active: true
    description: "Remind the user to drink water"
    fallback:
      title: "Stay hydrated"
      body: "Time to drink some water."
  nudge_posture:
    active: true
    description: "Remind the user to check posture"
    fallback:
      title: "Check your posture"
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
      expect(config.settings.quietHoursStart).toBe(22);
      expect(config.settings.cooldownMinutes).toBe(15);
      expect(config.settings.confidenceThreshold).toBe(0.5);
      expect(config.settings.actionHistoryCount).toBe(20);
      expect(config.settings.policyHistoryCount).toBe(8);
      expect(config.settings.actionDigestDays).toBe(3);
    });

    test("applies defaults for missing settings", () => {
      const config = loadConfig(MINIMAL_YAML);
      expect(config.settings.webcamDevice).toBe("/dev/video0");
      expect(config.settings.ollamaModel).toBe("gemma3:12b");
      expect(config.settings.logDir).toBe("./logs");
      expect(config.settings.captureDir).toBe("./captures");
      expect(config.settings.captureWidth).toBe(640);
      expect(config.settings.captureHeight).toBe(480);
      expect(config.settings.quietHoursStart).toBe(23);
      expect(config.settings.quietHoursEnd).toBe(7);
      expect(config.settings.cooldownMinutes).toBe(30);
      expect(config.settings.confidenceThreshold).toBe(0.3);
      expect(config.settings.actionHistoryCount).toBe(10);
      expect(config.settings.policyHistoryCount).toBe(5);
      expect(config.settings.actionDigestDays).toBe(1);
    });

    test("rejects invalid ollamaBaseUrl", () => {
      const yaml = `
settings:
  ollamaBaseUrl: not-a-url
actions:
  none:
    active: false
  log_only:
    active: false
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

    test("rejects confidence threshold out of range", () => {
      const yaml = `
settings:
  confidenceThreshold: 1.5
actions:
  none:
    active: false
  log_only:
    active: false
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

    test("rejects quiet hours out of range", () => {
      const yaml = `
settings:
  quietHoursStart: 25
actions:
  none:
    active: false
  log_only:
    active: false
`;
      expect(() => loadConfig(yaml)).toThrow();
    });
  });

  describe("actions", () => {
    test("parses actions with all fields", () => {
      const config = loadConfig(VALID_YAML);
      expect(Object.keys(config.actions)).toEqual([
        "none", "log_only", "nudge_break", "nudge_sleep",
      ]);
      expect(config.actions.nudge_break!.active).toBe(true);
      expect(config.actions.nudge_break!.description).toBe("Suggest the user take a short break");
      expect(config.actions.nudge_break!.fallback).toEqual({
        title: "Time for a break",
        body: "Consider standing up and stretching.",
      });
    });

    test("parses custom actions", () => {
      const config = loadConfig(CUSTOM_ACTION_YAML);
      expect(Object.keys(config.actions)).toContain("nudge_hydrate");
      expect(Object.keys(config.actions)).toContain("nudge_posture");
      expect(config.actions.nudge_hydrate!.active).toBe(true);
      expect(config.actions.nudge_hydrate!.fallback!.title).toBe("Stay hydrated");
    });

    test("rejects config without none action", () => {
      const yaml = `
actions:
  log_only:
    active: false
`;
      expect(() => loadConfig(yaml)).toThrow();
    });

    test("rejects config without log_only action", () => {
      const yaml = `
actions:
  none:
    active: false
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
  log_only:
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
      expect(config.getActionNames()).toEqual(["none", "log_only", "nudge_break", "nudge_sleep"]);
    });

    test("getActiveActions returns only active actions", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getActiveActions()).toEqual(["nudge_break", "nudge_sleep"]);
    });

    test("getPassiveActions returns only passive actions", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getPassiveActions()).toEqual(["none", "log_only"]);
    });

    test("getFallbackMessage returns fallback for active action", () => {
      const config = loadConfig(VALID_YAML);
      expect(config.getFallbackMessage("nudge_break")).toEqual({
        title: "Time for a break",
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
      expect(config.isActiveAction("log_only")).toBe(false);
      expect(config.isActiveAction("unknown_action")).toBe(false);
    });

    test("works with custom actions", () => {
      const config = loadConfig(CUSTOM_ACTION_YAML);
      expect(config.getActiveActions()).toEqual(["nudge_hydrate", "nudge_posture"]);
      expect(config.getPassiveActions()).toEqual(["none", "log_only"]);
      expect(config.getFallbackMessage("nudge_hydrate")).toEqual({
        title: "Stay hydrated",
        body: "Time to drink some water.",
      });
    });
  });
});
