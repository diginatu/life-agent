import { test, expect, describe } from "bun:test";
import { updateL4 } from "../../src/memory/update-l4.ts";
import type { OllamaAdapter } from "../../src/adapters/ollama.ts";

const PROMPT_TEMPLATE =
  "L4={l4Current}|L3={l3Content}|WS={l3WindowStart}|WE={l3WindowEnd}|MAX={l4MaxChars}";

const EVICTED_L3 = {
  content: "user worked on coding for 6 hours, took breaks",
  windowStart: "2026-04-10T00:00:00.000Z",
  windowEnd: "2026-04-10T06:00:00.000Z",
  sourceCount: 5,
};

function captureOllama(response: string): { ollama: OllamaAdapter; calls: string[] } {
  const calls: string[] = [];
  const ollama: OllamaAdapter = {
    generate: async (prompt: string) => {
      calls.push(prompt);
      return response;
    },
    generateWithImage: async () => response,
  };
  return { ollama, calls };
}

describe("updateL4", () => {
  test("fills prompt template with current L4, evicted L3 fields, and maxChars", async () => {
    const { ollama, calls } = captureOllama("new memory");
    await updateL4(ollama, "prior text", EVICTED_L3, PROMPT_TEMPLATE, 500);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(
      "L4=prior text|L3=user worked on coding for 6 hours, took breaks|WS=2026-04-10T00:00:00.000Z|WE=2026-04-10T06:00:00.000Z|MAX=500",
    );
  });

  test("empty current L4 renders as empty string", async () => {
    const { ollama, calls } = captureOllama("first memory");
    const result = await updateL4(ollama, "", EVICTED_L3, PROMPT_TEMPLATE, 500);

    expect(result).toBe("first memory");
    expect(calls[0]).toContain("L4=|");
  });

  test("trims whitespace from LLM response", async () => {
    const { ollama } = captureOllama("  padded memory  \n");
    const result = await updateL4(ollama, "x", EVICTED_L3, PROMPT_TEMPLATE, 500);
    expect(result).toBe("padded memory");
  });

  test("truncates to maxChars when LLM over-runs", async () => {
    const bigResponse = "a".repeat(1000);
    const { ollama } = captureOllama(bigResponse);
    const result = await updateL4(ollama, "", EVICTED_L3, PROMPT_TEMPLATE, 50);
    expect(result).toHaveLength(50);
    expect(result).toBe("a".repeat(50));
  });

  test("does not truncate when under maxChars", async () => {
    const { ollama } = captureOllama("short");
    const result = await updateL4(ollama, "", EVICTED_L3, PROMPT_TEMPLATE, 100);
    expect(result).toBe("short");
  });
});
