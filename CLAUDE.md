## Project Overview

Life Agent captures webcam images, analyzes them with a local LLM (Ollama), and sends desktop notifications for wellness nudges (break reminders, sleep prompts).

## Architecture

6-node LangGraph pipeline: Capture → Summarize → Policy → Action → Message → Persist.
Each node is a factory function (`createXxxNode(deps)`) returning an async state handler.

## Key Patterns

- **Adapter DI**: External services (Ollama, filesystem, ffmpeg, notifier) injected as interfaces. `--dry-run` uses mocks.
- **Config**: Zod-validated YAML (`config.yml` + `config.local.yml` override). Actions are data-driven.
- **Policy engine**: Quiet hours, cooldown, confidence threshold, duplicate suppression gate active actions.
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
