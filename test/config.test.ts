import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { loadConfig, CONFIG_ENV_KEYS } from "../src/config.ts";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all config-related env vars so defaults are tested
    for (const key of CONFIG_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test("returns defaults when no env vars set", () => {
    const config = loadConfig();
    expect(config.webcamDevice).toBe("/dev/video0");
    expect(config.ollamaModel).toBe("gemma3:12b");
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.logDir).toBe("./logs");
    expect(config.captureDir).toBe("./captures");
    expect(config.captureWidth).toBe(640);
    expect(config.captureHeight).toBe(480);
    expect(config.quietHoursStart).toBe(23);
    expect(config.quietHoursEnd).toBe(7);
    expect(config.cooldownMinutes).toBe(30);
    expect(config.confidenceThreshold).toBe(0.3);
  });

  test("overrides defaults with env vars", () => {
    process.env.WEBCAM_DEVICE = "/dev/video1";
    process.env.OLLAMA_MODEL = "llava:13b";
    process.env.CAPTURE_WIDTH = "1280";
    process.env.CONFIDENCE_THRESHOLD = "0.5";

    const config = loadConfig();
    expect(config.webcamDevice).toBe("/dev/video1");
    expect(config.ollamaModel).toBe("llava:13b");
    expect(config.captureWidth).toBe(1280);
    expect(config.confidenceThreshold).toBe(0.5);
  });

  test("coerces numeric strings to numbers", () => {
    process.env.CAPTURE_WIDTH = "800";
    process.env.QUIET_HOURS_START = "22";

    const config = loadConfig();
    expect(config.captureWidth).toBe(800);
    expect(config.quietHoursStart).toBe(22);
  });

  test("throws on invalid OLLAMA_BASE_URL", () => {
    process.env.OLLAMA_BASE_URL = "not-a-url";
    expect(() => loadConfig()).toThrow();
  });

  test("throws on confidence threshold out of range", () => {
    process.env.CONFIDENCE_THRESHOLD = "1.5";
    expect(() => loadConfig()).toThrow();
  });

  test("throws on quiet hours out of range", () => {
    process.env.QUIET_HOURS_START = "25";
    expect(() => loadConfig()).toThrow();
  });
});
