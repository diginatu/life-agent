import { test, expect, describe } from "bun:test";
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
});
