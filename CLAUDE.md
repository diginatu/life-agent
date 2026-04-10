## Project Overview

Life Agent captures webcam images, analyzes them with a local LLM (Ollama), and sends Discord notifications for wellness nudges (break reminders, sleep prompts).

## Architecture

7-node LangGraph pipeline: Capture → Summarize → Policy → Action → Message → Persist → ExtractMemories.
Each node is a factory function (`createXxxNode(deps)`) returning an async state handler.
Graph is compiled with a `BaseStore` (FileStore for production, InMemoryStore for dry-run) accessible via `config.store` in nodes.

## Key Patterns

- **Adapter DI**: External services (Ollama, filesystem, ffmpeg, Discord) injected as interfaces. `--dry-run` uses mocks.
- **Config**: Zod-validated YAML (`config.yml` + `config.local.yml` override). Actions are data-driven.
- **Policy engine**: Quiet hours, cooldown, confidence threshold, duplicate suppression gate active actions.
- **Long-term memory**: `FileStore` (custom `BaseStore` subclass) persists learned user patterns to `{memoryDir}/store.json`. ExtractMemories node writes; Action node reads. After each write, `mergeDuplicatePatterns` (LLM-driven, threshold-gated) collapses near-duplicate keys into canonical ones, then `capUserPatterns` enforces a max pattern count by evicting lowest `observedCount` first (tiebreak: oldest `lastObserved`).
- **Sprint convention**: Commits follow `feat: <description> (Sprint N)`.

Default to using Bun instead of Node.js.

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
