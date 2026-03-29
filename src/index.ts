import { loadConfig } from "./config.ts";
import { buildGraph } from "./graph.ts";

const _config = loadConfig();
const graph = buildGraph();

console.log("Running life-agent graph...\n");

const result = await graph.invoke({});

console.log(JSON.stringify(result, null, 2));

process.exit(result.errors?.length ? 1 : 0);
