# life-agent

LifeAgent is a local-first personal life assistant that captures periodic webcam snapshots, reasons over them with LLM workflows, and turns daily context into structured actions and reminders.

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Ollama](https://ollama.ai/) with `gemma3:12b` model pulled
- A webcam accessible at `/dev/video0` (or configure via `WEBCAM_DEVICE`)
- `ffmpeg` installed (for frame capture)
- `notify-send` installed (for desktop notifications, usually part of `libnotify`)

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

The agent runs a 6-node LangGraph pipeline on each invocation:

1. **Capture** — grabs a webcam frame via ffmpeg
2. **Summarize** — sends the image to Ollama for scene description
3. **Policy** — applies deterministic rules (quiet hours, cooldown, dedup)
4. **Action** — LLM selects an action from the allowed set
5. **Message** — LLM drafts a notification message (if needed)
6. **Persist** — writes JSONL log + sends desktop notification

Actions: `none` | `log_only` | `nudge_break` | `nudge_sleep`

All nodes degrade gracefully on failure (fail-closed to `log_only`).

## License

See [LICENSE](LICENSE).
