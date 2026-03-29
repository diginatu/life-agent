#!/usr/bin/env bash
set -euo pipefail

SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

systemctl --user disable --now life-agent.timer 2>/dev/null || true
systemctl --user disable life-agent.service 2>/dev/null || true

rm -f "${SYSTEMD_USER_DIR}/life-agent.service"
rm -f "${SYSTEMD_USER_DIR}/life-agent.timer"

systemctl --user daemon-reload

echo "Uninstalled life-agent service and timer"
