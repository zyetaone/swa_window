#!/usr/bin/env bash
# =============================================================================
# Aero Window — Pi 5 one-shot installer (idempotent).
#
# For corridor deployment (3 Pis × 2 corridors = 6 devices). Designed so a
# fresh Raspberry Pi OS Bookworm install, given network, can reach a working
# kiosk within ~10 min (plus tile cache download time).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zyetaone/z-aero-window/playground/maplibre-app/deploy/pi/install.sh | bash
#   # or, locally:
#   sudo bash deploy/pi/install.sh [--role left|center|right|solo] [--group corridor-a]
#
# Design goals:
#   1. Idempotent — re-running on an already-configured Pi is safe and fast.
#   2. No destructive operations (no `rm -rf`, no `--force` git).
#   3. Clone once, apt-get once per package, systemd-enable once per unit.
#   4. All failure paths leave the Pi in a recoverable state.
# =============================================================================

set -euo pipefail

# ─── Argument parsing ───────────────────────────────────────────────────────

AERO_ROLE="${AERO_ROLE:-solo}"
AERO_GROUP="${AERO_GROUP:-default}"
REPO_URL="${AERO_REPO_URL:-https://github.com/zyetaone/z-aero-window.git}"
REPO_BRANCH="${AERO_REPO_BRANCH:-playground/maplibre-app}"
INSTALL_DIR="/opt/aero-window"
PI_USER="${SUDO_USER:-pi}"
BUN_BIN="/home/${PI_USER}/.bun/bin/bun"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--role)   AERO_ROLE="$2"; shift 2 ;;
		--group)  AERO_GROUP="$2"; shift 2 ;;
		--branch) REPO_BRANCH="$2"; shift 2 ;;
		--help|-h)
			echo "Usage: install.sh [--role left|center|right|solo] [--group <id>] [--branch <git-branch>]"
			exit 0 ;;
		*)  echo "Unknown argument: $1" >&2; exit 1 ;;
	esac
done

if [[ $EUID -ne 0 ]]; then
	echo "This script must be run as root (sudo)." >&2
	exit 1
fi

echo "============================================"
echo "  Aero Window — Pi 5 Installer"
echo "============================================"
echo "Role:    ${AERO_ROLE}"
echo "Group:   ${AERO_GROUP}"
echo "Branch:  ${REPO_BRANCH}"
echo "User:    ${PI_USER}"
echo "Target:  ${INSTALL_DIR}"
echo ""

# ─── Step 1: System packages (idempotent — apt-get only upgrades what changed) ──

echo "[1/7] Installing system packages..."
apt-get update -qq
# No `-y upgrade` — leave OS patching to the operator's maintenance window.
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
	chromium \
	xserver-xorg \
	x11-xserver-utils \
	xinit \
	unclutter \
	openbox \
	network-manager \
	ddcutil \
	curl \
	git \
	ca-certificates \
	fonts-noto \
	cron

# ─── Step 2: Bun runtime (installs only if missing) ───────────────────────────

echo "[2/7] Installing Bun runtime..."
if [[ ! -x "${BUN_BIN}" ]]; then
	sudo -u "${PI_USER}" bash -c 'curl -fsSL https://bun.sh/install | bash'
else
	echo "  bun already installed at ${BUN_BIN}"
fi

# ─── Step 3: Clone repo (idempotent — fetch+checkout if already present) ──────

echo "[3/7] Fetching app source..."
mkdir -p "${INSTALL_DIR}"
chown "${PI_USER}:${PI_USER}" "${INSTALL_DIR}"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
	echo "  repo present — fetching latest on ${REPO_BRANCH}"
	sudo -u "${PI_USER}" git -C "${INSTALL_DIR}" fetch origin "${REPO_BRANCH}"
	sudo -u "${PI_USER}" git -C "${INSTALL_DIR}" checkout "${REPO_BRANCH}"
	sudo -u "${PI_USER}" git -C "${INSTALL_DIR}" pull --ff-only origin "${REPO_BRANCH}"
else
	sudo -u "${PI_USER}" git clone --branch "${REPO_BRANCH}" --depth 20 "${REPO_URL}" "${INSTALL_DIR}"
fi

# ─── Step 4: Bun install + build ──────────────────────────────────────────────

echo "[4/7] Installing dependencies + building..."
sudo -u "${PI_USER}" bash -c "cd '${INSTALL_DIR}' && '${BUN_BIN}' install"
sudo -u "${PI_USER}" bash -c "cd '${INSTALL_DIR}' && '${BUN_BIN}' run build"

# ─── Step 5: Write environment config ─────────────────────────────────────────

echo "[5/7] Writing environment config..."
install -d -m 755 -o "${PI_USER}" -g "${PI_USER}" /etc/aero
cat > /etc/aero/config.env <<EOF
# Managed by deploy/pi/install.sh — re-run install to regenerate.
AERO_ROLE=${AERO_ROLE}
AERO_GROUP=${AERO_GROUP}
AERO_INSTALL_DIR=${INSTALL_DIR}
AERO_USER=${PI_USER}
AERO_PORT=3000
EOF
chmod 644 /etc/aero/config.env

# ─── Step 6: Systemd units + cron jobs ────────────────────────────────────────

echo "[6/7] Installing systemd units + cron..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Copy units, rewriting placeholder paths for this install.
for unit in aero-xserver.service aero-app.service aero-kiosk.service; do
	sed \
		-e "s|__AERO_USER__|${PI_USER}|g" \
		-e "s|__AERO_INSTALL_DIR__|${INSTALL_DIR}|g" \
		-e "s|__BUN_BIN__|${BUN_BIN}|g" \
		"${SCRIPT_DIR}/${unit}" > "/etc/systemd/system/${unit}"
	chmod 644 "/etc/systemd/system/${unit}"
done

# Helper scripts — installed to /usr/local/lib/aero so units have a stable path.
install -d -m 755 /usr/local/lib/aero
install -m 755 "${SCRIPT_DIR}/health-check.sh"        /usr/local/lib/aero/health-check.sh
install -m 755 "${SCRIPT_DIR}/display-dim-schedule.sh" /usr/local/lib/aero/display-dim-schedule.sh

# Cron entries — written to /etc/cron.d so they're package-level, not user-level.
install -m 644 "${SCRIPT_DIR}/nightly-reboot.cron"       /etc/cron.d/aero-nightly-reboot
install -m 644 "${SCRIPT_DIR}/weekly-cache-clear.cron"   /etc/cron.d/aero-weekly-cache-clear
# Health + display-dim entries we generate here (they parameterise on AERO_* vars).
cat > /etc/cron.d/aero-health-check <<EOF
# Every 60s — report fps/temp/uptime via POST. Silent failure is OK.
* * * * * ${PI_USER} /usr/local/lib/aero/health-check.sh >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/aero-health-check

cat > /etc/cron.d/aero-display-dim <<EOF
# 2 AM dim to 5%, 6 AM restore to 100%.
0 2 * * * root /usr/local/lib/aero/display-dim-schedule.sh dim
0 6 * * * root /usr/local/lib/aero/display-dim-schedule.sh bright
EOF
chmod 644 /etc/cron.d/aero-display-dim

# ─── Step 7: Enable + start (idempotent — enable is a no-op on second run) ────

echo "[7/7] Enabling services..."
systemctl daemon-reload
systemctl enable aero-xserver.service aero-app.service aero-kiosk.service

# WiFi power-save off (idempotent write).
install -d -m 755 /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/aero-no-powersave.conf <<EOF
[connection]
wifi.powersave = 2
EOF

# Screen blanking off for the kiosk session (idempotent grep-guard).
if ! grep -q "consoleblank=0" /boot/firmware/cmdline.txt 2>/dev/null; then
	sed -i 's/$/ consoleblank=0/' /boot/firmware/cmdline.txt || true
fi

echo ""
echo "============================================"
echo "  Install complete"
echo "============================================"
echo "Start now:   sudo systemctl start aero-xserver aero-app aero-kiosk"
echo "Logs (app):  journalctl -u aero-app -f"
echo "Logs (X):    journalctl -u aero-kiosk -f"
echo "Reboot:      sudo reboot"
echo ""
echo "Role:        ${AERO_ROLE}   Group: ${AERO_GROUP}"
echo "URL:         http://localhost:3000/playground?role=${AERO_ROLE}&group=${AERO_GROUP}"
