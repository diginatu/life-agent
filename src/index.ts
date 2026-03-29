import { loadConfig } from "./config.ts";
import { buildGraph } from "./graph.ts";

const isDryRun = process.argv.includes("--dry-run");
const config = loadConfig();

let graph;
if (isDryRun) {
  const { createDryRunDeps } = await import("./dry-run.ts");
  console.log("[dry-run] Running with mock adapters\n");
  graph = buildGraph(config, createDryRunDeps());
} else {
  graph = buildGraph(config);
}

const result = await graph.invoke({});

console.log(JSON.stringify(result, null, 2));

process.exit(result.errors?.length ? 1 : 0);
