## Project Overview

Life Agent captures webcam images, analyzes them with a local LLM (Ollama), and sends Discord notifications for wellness nudges (break reminders, sleep prompts).

## Architecture

7-node LangGraph pipeline: Capture → CollectFeedback → Summarize → Action → Message → Persist → LayerUpdate.
Each node is a factory function (`createXxxNode(deps)`) returning an async state handler.
Graph is compiled with a `BaseStore` (FileStore for production, InMemoryStore for dry-run) accessible via `config.store` in nodes.

## Key Patterns

- **Adapter DI**: External services (Ollama, filesystem, ffmpeg, Discord) injected as interfaces. `--dry-run` uses mocks.
- **Config**: Zod-validated YAML (`config.yml` + `config.local.yml` override). Actions are data-driven.
- **Discord reply loop**: `CollectFeedback` node reads the last log entry's Discord cursor (`discordMessageId` or `discordLastSeenMessageId`), fetches replies via `discord.collectReplies`, and puts them on `state.userFeedback`. The `Action` node injects those replies into the LLM prompt in the same run (no multi-run delay). `Persist` writes them back to the log entry as `feedbackFromPrevious` for audit / history.
- **3-layer time-windowed memory**:
  - **L1** — raw JSONL log entries in `logs/`. Read from latest L2 `windowEnd` to now (no count cap).
  - **L2** — hourly LLM summary, delayed by `l2DelayHours` (default 1h) so recent logs stay in L1. Keyed by local-time hour `YYYY-MM-DDTHH`. Capped at `l2MaxRetention` entries (default 48 ≈ 2 days).
  - **L3** — 6-hour LLM summary of L2 entries, delayed by `l3DelayHours` (default 6h). Buckets aligned to 00/06/12/18 UTC. Capped at `l3MaxRetention` entries (default 28 ≈ 7 days).
  All three layers are injected into the Action prompt with no gap. `LayerUpdate` node runs each tick and catches up missed windows after sleep.
  Stored in `{memoryDir}/store.json` under namespaces `["memory","L2"]` and `["memory","L3"]`.
- **Sprint convention**: Commits follow `feat: <description> (Sprint N)`.

Default to using Bun instead of Node.js.

## Local installation & runtime

Installed as a systemd user service via `./install.sh`, which:
- Renders `systemd/life-agent.service.template` (substituting `{{PROJECT_DIR}}` and `{{BUN_PATH}}`) into `~/.config/systemd/user/life-agent.service`
- Copies `systemd/life-agent.timer.template` to the same dir
- Creates `config.local.yml` from `config.yml` if missing (machine-local override)
- Enables `life-agent.timer`

Service is `Type=oneshot`, `WorkingDirectory={repo}`, runs `bun run src/index.ts --config {repo}/config.local.yml`. Timer fires `OnCalendar=*:0/15` with `Persistent=true` (catches missed runs after sleep) and `RandomizedDelaySec=30`. `After=ollama.service` — depends on the local Ollama service being up.

Runtime paths (defaults in `src/config.ts`, relative to repo root which is the systemd WorkingDirectory):
- `./logs/` — JSONL action logs
- `./captures/` — webcam frame snapshots
- `./memory/store.json` — L2 hourly and L3 6-hour summaries (FileStore, namespaces `["memory","L2"]` and `["memory","L3"]`)
- Web dashboard: `http://localhost:3000` (`bun run src/web/entry.ts`)

Operating a running install:
- Logs: `journalctl --user -u life-agent -f` (or `-e` to jump to end, `-n 200` for last N)
- Status / next scheduled run: `systemctl --user status life-agent.service`, `systemctl --user list-timers life-agent.timer`
- Trigger a one-off tick: `systemctl --user start life-agent.service`
- Reinstall after editing templates: re-run `./install.sh`; uninstall via `./uninstall.sh`

Gotchas:
- Manual `bun run src/index.ts` uses `config.yml`, **not** `config.local.yml` — pass `--config config.local.yml` to match systemd behavior.
- The systemd unit has `ProtectSystem=strict`. Writable paths are limited to `logs/`, `captures/`, and `memory/` via `ReadWritePaths`. If you add a new on-disk output directory, add it here too and re-run `./install.sh`.
- The unit template does **not** load any `EnvironmentFile`. If a future feature needs env vars (Discord token, API keys), the unit must be updated, not just `.env` set in the user shell.
- Use `bun run src/index.ts --dry-run` to exercise the pipeline without webcam/Ollama/Discord.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

## Frontend

Use HTML imports with `Bun.serve()`.

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

Run index.ts

```sh
bun --hot ./index.ts
```

## Links

LangChain: https://docs.langchain.com/llms.txt
