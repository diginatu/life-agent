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

# Copy and edit environment config
cp .env.example .env
# Edit .env to match your setup (defaults work for most cases)
```

## Usage

```bash
# Run once (requires webcam + Ollama)
bun run src/index.ts

# Run with mock adapters (no hardware/Ollama needed)
bun run src/index.ts --dry-run

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

All settings are configured via environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `WEBCAM_DEVICE` | `/dev/video0` | Webcam device path |
| `OLLAMA_MODEL` | `gemma3:12b` | Ollama model name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL |
| `LOG_DIR` | `./logs` | JSONL log output directory |
| `CAPTURE_DIR` | `./captures` | Webcam frame output directory |
| `CAPTURE_WIDTH` | `640` | Capture width in pixels |
| `CAPTURE_HEIGHT` | `480` | Capture height in pixels |
| `QUIET_HOURS_START` | `23` | Start of quiet hours (24h) |
| `QUIET_HOURS_END` | `7` | End of quiet hours (24h) |
| `COOLDOWN_MINUTES` | `30` | Minimum minutes between nudges |
| `CONFIDENCE_THRESHOLD` | `0.3` | Minimum confidence to act |

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
