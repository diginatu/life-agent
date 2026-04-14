import { test, expect, describe, spyOn, afterEach } from "bun:test";
import { createOllamaAdapter, type LlmInvoker } from "../../src/adapters/ollama.ts";

function mockInvoker(responseContent: string): LlmInvoker {
  return {
    invoke: async () => ({ content: responseContent }),
  };
}

function errorInvoker(error: Error): LlmInvoker {
  return {
    invoke: async () => { throw error; },
  };
}

describe("OllamaAdapter", () => {
  describe("generate (text-only)", () => {
    test("returns response text on success", async () => {
      const adapter = createOllamaAdapter(mockInvoker('{"answer": "hello"}'));
      const result = await adapter.generate("Say hello");
      expect(result).toBe('{"answer": "hello"}');
    });

    test("throws on invocation error", async () => {
      const adapter = createOllamaAdapter(errorInvoker(new Error("connection refused")));
      await expect(adapter.generate("test")).rejects.toThrow("connection refused");
    });

    test("passes format option to invoker call options", async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const invoker: LlmInvoker = {
        invoke: async (_messages, options) => {
          capturedOptions = options;
          return { content: '{"patterns":[]}' };
        },
      };
      const adapter = createOllamaAdapter(invoker);
      const format = { type: "object", properties: { test: { type: "string" } } };
      await adapter.generate("test prompt", { format });

      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.format).toEqual(format);
    });
  });

  describe("generateWithImage", () => {
    test("returns response text on success", async () => {
      const invoker = mockInvoker('{"personPresent": true}');
      const adapter = createOllamaAdapter(invoker);

      const result = await adapter.generateWithImage(
        "Describe this image",
        "base64imagedata"
      );
      expect(result).toBe('{"personPresent": true}');
    });

    test("passes image data to invoker", async () => {
      let capturedMessages: unknown[] = [];
      const invoker: LlmInvoker = {
        invoke: async (messages) => {
          capturedMessages = messages as unknown[];
          return { content: "ok" };
        },
      };
      const adapter = createOllamaAdapter(invoker);

      await adapter.generateWithImage("Describe", "abc123base64");

      expect(capturedMessages).toHaveLength(1);
      const msg = capturedMessages[0] as { content: unknown[] };
      expect(msg.content).toHaveLength(2);
    });

    test("throws on invocation error", async () => {
      const adapter = createOllamaAdapter(errorInvoker(new Error("timeout")));
      await expect(
        adapter.generateWithImage("test", "img")
      ).rejects.toThrow("timeout");
    });
  });

  describe("debug logging", () => {
    let logSpy: ReturnType<typeof spyOn>;

    afterEach(() => {
      logSpy?.mockRestore();
    });

    test("logs prompt and response for generate", async () => {
      logSpy = spyOn(console, "log").mockImplementation(() => {});
      const adapter = createOllamaAdapter(mockInvoker("response text"));
      await adapter.generate("my prompt");

      const logs: string[] = logSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(logs.some((l) => l.includes("[LLM prompt]") && l.includes("my prompt"))).toBe(true);
      expect(logs.some((l) => l.includes("[LLM response]") && l.includes("response text"))).toBe(true);
    });

    test("logs prompt and response for generateWithImage", async () => {
      logSpy = spyOn(console, "log").mockImplementation(() => {});
      const adapter = createOllamaAdapter(mockInvoker("image response"));
      await adapter.generateWithImage("describe image", "base64data");

      const logs: string[] = logSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(logs.some((l) => l.includes("[LLM prompt]") && l.includes("describe image"))).toBe(true);
      expect(logs.some((l) => l.includes("[LLM response]") && l.includes("image response"))).toBe(true);
    });

    test("does not log image data", async () => {
      logSpy = spyOn(console, "log").mockImplementation(() => {});
      const adapter = createOllamaAdapter(mockInvoker("ok"));
      await adapter.generateWithImage("describe", "secretbase64data");

      const logs: string[] = logSpy.mock.calls.map((c: unknown[]) => c.join(" "));
      expect(logs.some((l) => l.includes("secretbase64data"))).toBe(false);
    });
  });
});
