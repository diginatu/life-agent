import { test, expect, describe } from "bun:test";
import { buildGraph } from "../src/graph.ts";

describe("buildGraph (hello/goodbye)", () => {
  test("produces greeting and farewell", async () => {
    const graph = buildGraph();
    const result = await graph.invoke({});

    expect(result.greeting).toMatch(/^Hello from life-agent at /);
    expect(result.farewell).toContain(result.greeting);
    expect(result.errors).toEqual([]);
  });
});
