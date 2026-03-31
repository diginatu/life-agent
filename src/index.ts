import { loadConfigFromFile } from "./config.ts";
import { buildGraph } from "./graph.ts";

const isDryRun = process.argv.includes("--dry-run");
const isDigest = process.argv.includes("--digest");
const configFlagIndex = process.argv.indexOf("--config");
const configPath = configFlagIndex !== -1
  ? process.argv[configFlagIndex + 1]!
  : "./config.yml";

const config = await loadConfigFromFile(configPath);

if (isDigest) {
  const { runDigest } = await import("./digest/cli.ts");
  const dateFlagIndex = process.argv.indexOf("--date");
  const date = dateFlagIndex !== -1
    ? process.argv[dateFlagIndex + 1]!
    : new Date().toISOString().slice(0, 10);
  await runDigest(config, date);
} else {
  let graph;
  if (isDryRun) {
    const { createDryRunDeps } = await import("./dry-run.ts");
    console.log("[dry-run] Running with mock adapters\n");
    graph = await buildGraph(config, createDryRunDeps());
  } else {
    graph = await buildGraph(config);
  }

  const result = await graph.invoke({});
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.errors?.length ? 1 : 0);
}
