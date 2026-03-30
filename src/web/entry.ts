import { loadConfigFromFile } from "../config.ts";
import { createFilesystemAdapter } from "../adapters/filesystem.ts";
import { createServer } from "./server.ts";

const configFlagIndex = process.argv.indexOf("--config");
const configPath = configFlagIndex !== -1
  ? process.argv[configFlagIndex + 1]!
  : "./config.yml";

const config = await loadConfigFromFile(configPath);
const fs = createFilesystemAdapter();

const server = createServer({ fs, port: config.settings.webPort, logDir: config.settings.logDir });
console.log(`Life Agent Dashboard running at http://${server.hostname}:${server.port}`);
