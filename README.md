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
2. **CollectFeedback** — pulls any new Discord replies since the last run
3. **Summarize** — sends the image to Ollama for scene description
4. **Action** — LLM selects an action using L1/L2/L3/L4 memory layers and the latest user reply
5. **Message** — LLM drafts a notification message (if needed)
6. **Persist** — writes JSONL log + sends Discord notification
7. **LayerUpdate** — rolls up L1 logs into hourly L2 summaries, L2 into 6-hour L3 summaries, prunes raw L1 logs once they are safely covered by L3, and distills evicted L3 entries into a single persistent L4 memory text (delayed, idempotent, catches up after sleep)

Actions are data-driven via `config.yml`; see that file for the current set.

All nodes degrade gracefully on failure (fail-closed to `none`).

## License

See [LICENSE](LICENSE).
