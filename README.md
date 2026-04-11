# life-agent

LifeAgent is a local-first personal life assistant that captures periodic webcam snapshots, reasons over them with LLM workflows, and turns daily context into structured actions and reminders.

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Ollama](https://ollama.ai/) with `gemma3:12b` model pulled
- A webcam accessible at `/dev/video0` (or configure via `WEBCAM_DEVICE`)
- `ffmpeg` installed (for frame capture)


## Setup

```bash
# Install dependencies
bun install

# Edit config (defaults work for most cases)
# See config.yml for all settings and action definitions
```

## Usage

```bash
# Run once (requires webcam + Ollama)
bun run src/index.ts

# Run with mock adapters (no hardware/Ollama needed)
bun run src/index.ts --dry-run

# Daily digest (summarize today's logs with LLM)
bun run src/index.ts --digest
bun run src/index.ts --digest --date 2026-03-29

# Web dashboard (view timeline at http://localhost:3000)
bun run src/web/entry.ts

# Run tests
bun test
```

## systemd Timer (auto-run every 15 minutes)

Install as a systemd user service:

```bash
./install.sh
```

The install script generates unit files from templates (substituting your project path and bun location), installs them to `~/.config/systemd/user/`, and enables the timer.

To run manually via systemd:

```bash
systemctl --user start life-agent.service
```

To view logs:

```bash
journalctl --user -u life-agent -f
```

To uninstall:

```bash
./uninstall.sh
```

## Configuration

All settings and actions are defined in `config.yml`. Use `--config <path>` to specify a different config file.

To add a custom action (e.g. hydration reminder), just add it to `config.yml`:

```yaml
actions:
  nudge_hydrate:
    active: true
    description: Remind the user to drink water
    fallback:
      title: Stay hydrated
      body: Time to drink some water.
```

See `config.yml` for all available settings and their defaults.

## Pipeline

The agent runs a 7-node LangGraph pipeline on each invocation:

1. **Capture** — grabs a webcam frame via ffmpeg
2. **CollectFeedback** — pulls any new Discord replies since the last run and attaches them to state so the action step can react in the same run
3. **Summarize** — sends the image to Ollama for scene description
4. **Action** — LLM selects an action from the allowed set, using history, digests, long-term patterns, and the latest user reply
5. **Message** — LLM drafts a notification message (if needed)
6. **Persist** — writes JSONL log + sends Discord notification
7. **ExtractMemories** — LLM distills the observation into long-term user patterns, then runs a duplicate-merge pass and caps the pattern store (LRU by `observedCount`)

Actions are data-driven via `config.yml`; see that file for the current set.

All nodes degrade gracefully on failure (fail-closed to `none`).

## License

See [LICENSE](LICENSE).
