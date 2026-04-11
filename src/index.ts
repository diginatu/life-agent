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

  let discord;
  const digestChannelId = config.settings.discordDigestChannelId || config.settings.discordChannelId;
  if (digestChannelId) {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (token) {
      const { createDiscordAdapter } = await import("./adapters/discord.ts");
      discord = await createDiscordAdapter(token, digestChannelId);
    }
  }

  await runDigest(config, date, { discord });
  await discord?.destroy();
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

  // Auto-digest: generate and send if none sent in last 24h
  const { shouldRunDigest, runDigest } = await import("./digest/cli.ts");
  const { createFilesystemAdapter } = await import("./adapters/filesystem.ts");
  const now = new Date();
  const fs = isDryRun
    ? (await import("./dry-run.ts")).createDryRunDeps().fs
    : createFilesystemAdapter();

  if (await shouldRunDigest(fs, config.settings.logDir, now)) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    console.log(`\nAuto-digest: generating digest for ${yesterday}`);

    let discord;
    const digestChannelId = config.settings.discordDigestChannelId || config.settings.discordChannelId;
    if (!isDryRun && digestChannelId) {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (token) {
        const { createDiscordAdapter } = await import("./adapters/discord.ts");
        discord = await createDiscordAdapter(token, digestChannelId);
      }
    }

    await runDigest(config, yesterday, { fs, discord });
    await discord?.destroy();
  }

  process.exit(result.errors?.length ? 1 : 0);
}
