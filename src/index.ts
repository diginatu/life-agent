import { loadConfigFromFile } from "./config.ts";
import { buildGraph } from "./graph.ts";

const isDryRun = process.argv.includes("--dry-run");
const configFlagIndex = process.argv.indexOf("--config");
const configPath = configFlagIndex !== -1
  ? process.argv[configFlagIndex + 1]!
  : "./config.yml";

const config = await loadConfigFromFile(configPath);

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
