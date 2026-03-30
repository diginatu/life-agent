#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUN_PATH="$(command -v bun 2>/dev/null || true)"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

if [ -z "$BUN_PATH" ]; then
  echo "Error: bun not found in PATH" >&2
  exit 1
fi

echo "Project dir: ${PROJECT_DIR}"
echo "Bun path:    ${BUN_PATH}"
echo "Systemd dir: ${SYSTEMD_USER_DIR}"
echo

# Generate unit files from templates
mkdir -p "${SYSTEMD_USER_DIR}"

sed -e "s|{{PROJECT_DIR}}|${PROJECT_DIR}|g" \
    -e "s|{{BUN_PATH}}|${BUN_PATH}|g" \
    "${PROJECT_DIR}/systemd/life-agent.service.template" \
    > "${SYSTEMD_USER_DIR}/life-agent.service"

cp "${PROJECT_DIR}/systemd/life-agent.timer.template" \
   "${SYSTEMD_USER_DIR}/life-agent.timer"

# Create local config if it doesn't exist
if [ ! -f "${PROJECT_DIR}/config.local.yml" ]; then
  cp "${PROJECT_DIR}/config.yml" "${PROJECT_DIR}/config.local.yml"
  echo "Created config.local.yml — edit it to customize settings for this machine."
fi

# Reload and enable
systemctl --user daemon-reload
systemctl --user enable --now life-agent.timer

echo
echo "Installed and started life-agent.timer"
echo "Check status: systemctl --user list-timers life-agent.timer"
echo "View logs:    journalctl --user -u life-agent -f"
