#!/usr/bin/env bash
# =============================================================================
# Aero Window — Pi 5 one-shot installer (idempotent).
#
# For corridor deployment (3 Pis × 2 corridors = 6 devices). Designed so a
# fresh Raspberry Pi OS Bookworm install, given network, can reach a working
# kiosk within ~10 min (plus tile cache download time).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zyetaone/z-aero-window/main/deploy/pi/install.sh | bash
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
REPO_BRANCH="${AERO_REPO_BRANCH:-main}"
INSTALL_DIR="/opt/aero-window"
PI_USER="${SUDO_USER:-pi}"
BUN_BIN="/home/${PI_USER}/.bun/bin/bun"
# Pre-git hand-copied layout found on the first fielded Pi. Only read from —
# never modified or removed — so a failed migration leaves it intact.
LEGACY_DIR="/home/${PI_USER}/aero-window"

# --units-only: reinstall ONLY the systemd units, helper scripts and cron
# entries, skipping apt / bun / clone / build / config.env and the boot-partition
# branding. This is the OTA path: aero-updater.sh calls it when a release changed
# anything under deploy/, because `git pull` updates deploy/pi/*.service in the
# REPO but nothing ever copied them to /etc/systemd/system — so unit-level fixes
# (GPU flags, VT handling, ExecStart changes) reached devices and did nothing.
# Deliberately excluded here: apt (slow, needs network), the build (the updater
# just did it), config.env (would clobber hand-set tokens), and the cmdline.txt /
# config.txt rewrites (a bad boot-partition edit is an unbootable Pi and the
# updater's git-only rollback cannot undo it — that stays a human, on-console act).
UNITS_ONLY=false

# One-time backup of a boot-partition file before this script first edits it.
# The header above notes that a bad boot-partition edit is an unbootable Pi and
# the updater's git-only rollback cannot undo it — so leave the operator a copy
# they can restore from a rescue boot or by pulling the SD card.
#
# `.aero-orig` (not a timestamped name) on purpose: this must capture the
# PRE-AERO state exactly once. Re-provisioning a device that already has our
# tokens applied would otherwise overwrite the pristine copy with a modified
# one, which is the moment the backup stops being worth anything.
backup_boot_file() {
	local f="$1"
	[[ -f "${f}" ]] || return 0
	[[ -e "${f}.aero-orig" ]] && return 0
	cp -p "${f}" "${f}.aero-orig" 2>/dev/null \
		&& echo "      + backed up $(basename "${f}") → $(basename "${f}").aero-orig" \
		|| echo "      ! could not back up ${f} (continuing)"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--role)   AERO_ROLE="$2"; shift 2 ;;
		--group)  AERO_GROUP="$2"; shift 2 ;;
		--branch) REPO_BRANCH="$2"; shift 2 ;;
		--units-only) UNITS_ONLY=true; shift ;;
		--help|-h)
			echo "Usage: install.sh [--role left|center|right|solo] [--group <id>] [--branch <git-branch>] [--units-only]"
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

if [[ "${UNITS_ONLY}" == true ]]; then
	echo "--units-only: skipping packages / bun / clone / build / config.env."
	echo ""
fi

if [[ "${UNITS_ONLY}" == false ]]; then

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
	fonts-ubuntu \
	fonts-jetbrains-mono \
	plymouth \
	cron \
	logrotate

# fonts-ubuntu + fonts-jetbrains-mono are NOT optional: the app declares both
# (shell HUD, TelemetryOverlay, BootLockup). Pi OS ships neither, so without
# them every panel silently falls back to DejaVu and the boot splash stops
# matching the app's first frame. plymouth carries the boot theme below.

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
	# Explicit refspec + checkout -B: the initial clone is single-branch, so a
	# plain fetch never materialises a DIFFERENT branch, plain checkout then
	# fails (pathspec), and pull --ff-only breaks after any force-push.
	sudo -u "${PI_USER}" git -C "${INSTALL_DIR}" fetch origin "+refs/heads/${REPO_BRANCH}:refs/remotes/origin/${REPO_BRANCH}"
	sudo -u "${PI_USER}" git -C "${INSTALL_DIR}" checkout -B "${REPO_BRANCH}" "origin/${REPO_BRANCH}"
else
	sudo -u "${PI_USER}" git clone --branch "${REPO_BRANCH}" --depth 20 "${REPO_URL}" "${INSTALL_DIR}"
fi

# ─── Step 4: Build-time env + bun install + build ─────────────────────────────

echo "[4/7] Installing dependencies + building..."

# VITE_* vars are INLINED AT BUILD TIME (src/lib/world/cesium-setup.ts reads
# import.meta.env.VITE_CESIUM_ION_TOKEN). This does not fail loudly once — the
# updater rebuilds on EVERY release, so a missing .env silently ships a
# tokenless build (no Ion terrain, no Ion imagery) forever. .env is gitignored,
# so seeding it once survives the updater's `git reset --hard`.
if [[ -f "${INSTALL_DIR}/.env" ]]; then
	echo "  .env present — leaving as-is"
elif [[ -n "${VITE_CESIUM_ION_TOKEN:-}" ]]; then
	printf 'VITE_CESIUM_ION_TOKEN=%s\n' "${VITE_CESIUM_ION_TOKEN}" > "${INSTALL_DIR}/.env"
	chown "${PI_USER}:${PI_USER}" "${INSTALL_DIR}/.env"
	chmod 600 "${INSTALL_DIR}/.env"
	echo "  wrote .env from VITE_CESIUM_ION_TOKEN"
elif [[ -f "${LEGACY_DIR}/.env" ]]; then
	install -m 600 -o "${PI_USER}" -g "${PI_USER}" "${LEGACY_DIR}/.env" "${INSTALL_DIR}/.env"
	echo "  migrated .env from ${LEGACY_DIR}"
else
	echo "  WARNING: no .env and no VITE_CESIUM_ION_TOKEN in the environment."
	echo "           Cesium Ion terrain + imagery will be DISABLED in this build."
	echo "           Re-run as: sudo VITE_CESIUM_ION_TOKEN=... bash $0 ..."
fi

sudo -u "${PI_USER}" bash -c "cd '${INSTALL_DIR}' && '${BUN_BIN}' install"
# VITE_* are compile-time in Vite, so they must be present HERE — this build
# runs before /etc/aero/config.env is written (step 5), and would otherwise
# bake in "no local tile server" no matter what config.env later says. Passed
# inside the bash -c string because sudo scrubs the caller's environment.
# Same default as TILE_SERVER_URL_VALUE in step 5; the two are re-derived
# rather than shared because that block has not run yet at this point.
sudo -u "${PI_USER}" bash -c "cd '${INSTALL_DIR}' && VITE_TILE_SERVER_URL='${VITE_TILE_SERVER_URL:-/api/tiles}' '${BUN_BIN}' run build"

# ─── Step 5: Write environment config ─────────────────────────────────────────

echo "[5/7] Writing environment config..."
install -d -m 755 -o "${PI_USER}" -g "${PI_USER}" /etc/aero
# Preserve hand-configured secrets across re-runs — regenerating this file
# used to wipe them. AERO_ADMIN_URL silently killed the WAN heartbeat;
# AERO_ADMIN_TOKEN silently 503s every admin endpoint (requireAdminToken is
# fail-closed), which looks like a broken app rather than a wiped config.
EXISTING_ADMIN_URL=""
EXISTING_ADMIN_TOKEN=""
EXISTING_ION_TOKEN=""
EXISTING_FLEET_TOKEN=""
if [[ -r /etc/aero/config.env ]]; then
	EXISTING_ADMIN_URL="$(command grep -oP '^AERO_ADMIN_URL=\K.*' /etc/aero/config.env 2>/dev/null || true)"
	EXISTING_ADMIN_TOKEN="$(command grep -oP '^AERO_ADMIN_TOKEN=\K.*' /etc/aero/config.env 2>/dev/null || true)"
	EXISTING_ION_TOKEN="$(command grep -oP '^CESIUM_ION_TOKEN=\K.*' /etc/aero/config.env 2>/dev/null || true)"
	EXISTING_FLEET_TOKEN="$(command grep -oP '^AERO_FLEET_TOKEN=\K.*' /etc/aero/config.env 2>/dev/null || true)"
fi

# Central heartbeat collector, e.g.
#   AERO_ADMIN_URL=http://collector:3000 AERO_FLEET_TOKEN=<shared> \
#     bash deploy/pi/install.sh --role center --group wall-1
#
# Env override on a FRESH install only, mirroring AERO_FLEET_TOKEN below (an
# existing value always wins, so re-runs never clobber a hand-tuned config).
# Without this there was no way to aim a new Pi at a collector during install:
# health-check.sh then defaults to posting at THIS device, where the samples
# land in a per-server in-memory store that nothing aggregates. Every Pi looks
# healthy on its own /admin/fleet/health page while the fleet view stays empty.
if [[ -z "${EXISTING_ADMIN_URL}" && -n "${AERO_ADMIN_URL:-}" ]]; then
	EXISTING_ADMIN_URL="${AERO_ADMIN_URL}"
fi

# Shared LAN secret for the telemetry heartbeat. Distinct from
# AERO_ADMIN_TOKEN so health-check.sh holds a credential that can only report
# metrics, never push scenes or trigger an OTA.
#
# AUTO-GENERATED rather than left blank: POST /api/fleet/heartbeat is
# fail-closed, so an unset token means every heartbeat 503s and the fleet
# health dashboard is permanently empty — while each Pi looks fine locally,
# because health-check.sh swallows curl errors on purpose. A silent monitoring
# blackout is worse than a generated secret. Operators who want a fleet-wide
# shared value can overwrite it; re-runs preserve whatever is already there.
if [[ -z "${EXISTING_FLEET_TOKEN}" ]]; then
	if [[ -n "${AERO_FLEET_TOKEN:-}" ]]; then
		EXISTING_FLEET_TOKEN="${AERO_FLEET_TOKEN}"
	elif command -v openssl >/dev/null 2>&1; then
		EXISTING_FLEET_TOKEN="$(openssl rand -hex 24)"
	else
		EXISTING_FLEET_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	fi
fi

# Cesium Ion token, served at RUNTIME by /api/internal/ion-token instead of
# being inlined into the client bundle at build time. Seeded, in order, from:
# an existing config.env value, the CESIUM_ION_TOKEN env of this run, or the
# .env this installer already manages. Keeping it here (not in .env) is what
# lets a device consume a CI-built, secret-free artifact.
if [[ -z "${EXISTING_ION_TOKEN}" ]]; then
	if [[ -n "${CESIUM_ION_TOKEN:-}" ]]; then
		EXISTING_ION_TOKEN="${CESIUM_ION_TOKEN}"
	elif [[ -r "${INSTALL_DIR}/.env" ]]; then
		EXISTING_ION_TOKEN="$(command grep -oP '^VITE_CESIUM_ION_TOKEN=\K.*' "${INSTALL_DIR}/.env" 2>/dev/null || true)"
	fi
fi

# Tile cache. api/tiles resolves TILE_DIR env → /opt/zyeta-aero/tiles →
# ./data/tiles — none of which is this install's dir, so leaving TILE_DIR unset
# turns every tile into a remote fetch on a box whose whole point is offline
# operation. data/ is gitignored, so the cache survives the updater's reset.
TILE_DIR_VALUE="${INSTALL_DIR}/data/tiles"
# Client-side base for the same cache. Overridable for an external tile host;
# the default is this app's own route, so no per-device host/port to maintain.
TILE_SERVER_URL_VALUE="${VITE_TILE_SERVER_URL:-/api/tiles}"
if [[ -d "${LEGACY_DIR}/data/tiles" && ! -d "${TILE_DIR_VALUE}" ]]; then
	echo "  migrating tile cache from ${LEGACY_DIR}/data/tiles (copy — original left intact)"
	install -d -m 755 -o "${PI_USER}" -g "${PI_USER}" "${INSTALL_DIR}/data"
	cp -a "${LEGACY_DIR}/data/tiles" "${TILE_DIR_VALUE}"
	chown -R "${PI_USER}:${PI_USER}" "${TILE_DIR_VALUE}"
fi

cat > /etc/aero/config.env <<EOF
# Managed by deploy/pi/install.sh — re-run install to regenerate.
AERO_ROLE=${AERO_ROLE}
AERO_GROUP=${AERO_GROUP}
AERO_INSTALL_DIR=${INSTALL_DIR}
AERO_USER=${PI_USER}
AERO_PORT=3000
AERO_ADMIN_URL=${EXISTING_ADMIN_URL}
AERO_ADMIN_TOKEN=${EXISTING_ADMIN_TOKEN}
AERO_FLEET_TOKEN=${EXISTING_FLEET_TOKEN}
AERO_BUN_BIN=${BUN_BIN}
AERO_BRANCH=release
TILE_DIR=${TILE_DIR_VALUE}
CESIUM_ION_TOKEN=${EXISTING_ION_TOKEN}
# Client-side base for the packaged tile cache. Vite inlines VITE_* at BUILD
# time, so this is read by aero-updater.sh's rebuild (which exports config.env
# via set -a), not at runtime. Relative on purpose — the app serves its own
# tiles from /api/tiles, so there is no host or port to get wrong per device.
# Safe to leave set even with an empty TILE_DIR: the client probes
# /api/tiles/health, which reports hasTiles, and falls back to the remote
# imagery/terrain hosts when the cache is empty.
VITE_TILE_SERVER_URL=${TILE_SERVER_URL_VALUE}
EOF
# 0640 root:${PI_USER} — this file now carries the admin bearer token, so it
# must not stay world-readable the way a pure-config file could.
chown "root:${PI_USER}" /etc/aero/config.env
chmod 640 /etc/aero/config.env

fi  # end !UNITS_ONLY (steps 1-5)

# ─── Step 5b: additive config.env keys (runs in BOTH modes) ──────────────────
# Keys the app grows AFTER a device was provisioned must still reach it via
# OTA: aero-updater.sh re-runs this installer with --units-only, which skips
# the full config.env write above (it would reset AERO_ROLE/GROUP — the
# updater passes no --role --group — and drop operator-added keys). Without
# this block, a Pi imaged before AERO_FLEET_TOKEN existed never gets one:
# POST /api/fleet/heartbeat is fail-closed and health-check.sh swallows curl
# errors, so the fleet health page stays silently empty forever.
#
# Append-only and idempotent: existing values (including a fleet-shared token
# hand-provisioned by the operator) are preserved; '=.' treats an empty value
# as missing. systemd EnvironmentFile last-wins, so appending is safe even if
# a duplicate somehow exists.
if [[ -f /etc/aero/config.env ]] && ! command grep -q '^AERO_FLEET_TOKEN=.' /etc/aero/config.env; then
	ADDED_FLEET_TOKEN=""
	if command -v openssl >/dev/null 2>&1; then
		ADDED_FLEET_TOKEN="$(openssl rand -hex 24)"
	else
		ADDED_FLEET_TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
	fi
	echo "AERO_FLEET_TOKEN=${ADDED_FLEET_TOKEN}" >> /etc/aero/config.env
	echo "  added missing AERO_FLEET_TOKEN to /etc/aero/config.env (generated)"
fi

# ─── Step 6: Systemd units + cron jobs ────────────────────────────────────────

echo "[6/7] Installing systemd units + cron..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Copy units, rewriting placeholder paths for this install.
for unit in aero-xserver.service aero-app.service aero-kiosk.service aero-updater.service; do
	sed \
		-e "s|__AERO_USER__|${PI_USER}|g" \
		-e "s|__AERO_INSTALL_DIR__|${INSTALL_DIR}|g" \
		-e "s|__BUN_BIN__|${BUN_BIN}|g" \
		"${SCRIPT_DIR}/${unit}" > "/etc/systemd/system/${unit}"
	chmod 644 "/etc/systemd/system/${unit}"
done
# The updater timer has no placeholders — copy verbatim.
install -m 644 "${SCRIPT_DIR}/aero-updater.timer" /etc/systemd/system/aero-updater.timer

# Passwordless sudo for exactly the commands the app's privileged endpoints
# run (/api/update, /api/wifi/reset). Without this, `sudo -n` fails and — now
# that both endpoints preflight it — the operator gets a truthful 503 instead
# of a silent no-op. Validated with visudo before installing; a broken
# fragment can lock out sudo entirely, so a failed validation skips it.
sed "s|__AERO_USER__|${PI_USER}|g" "${SCRIPT_DIR}/aero.sudoers" > /etc/sudoers.d/aero.tmp
if visudo -cf /etc/sudoers.d/aero.tmp >/dev/null 2>&1; then
	install -m 440 /etc/sudoers.d/aero.tmp /etc/sudoers.d/aero
else
	echo "  WARN: sudoers fragment failed visudo validation — skipping (privileged endpoints will 503)"
fi
rm -f /etc/sudoers.d/aero.tmp

# Retire units from superseded layouts. The loop above only OVERWRITES units it
# still ships, so a unit that was dropped from the project survives a re-provision
# and keeps auto-starting forever. aero-fleet ran the standalone WebSocket broker
# deleted in Phase 9 (replaced by REST + SSE inside the app itself).
DEAD_UNITS=(aero-fleet.service)
for dead_unit in "${DEAD_UNITS[@]}"; do
	if [[ -f "/etc/systemd/system/${dead_unit}" ]]; then
		systemctl disable --now "${dead_unit}" >/dev/null 2>&1 || true
		rm -f "/etc/systemd/system/${dead_unit}"
		echo "  retired ${dead_unit} (superseded layout)"
	fi
done

# Helper scripts — installed to /usr/local/lib/aero so units have a stable path.
install -d -m 755 /usr/local/lib/aero
install -m 755 "${SCRIPT_DIR}/health-check.sh"        /usr/local/lib/aero/health-check.sh
install -m 755 "${SCRIPT_DIR}/display-dim-schedule.sh" /usr/local/lib/aero/display-dim-schedule.sh

# Cron entries — written to /etc/cron.d so they're package-level, not user-level.
install -m 644 "${SCRIPT_DIR}/nightly-reboot.cron"       /etc/cron.d/aero-nightly-reboot
install -m 644 "${SCRIPT_DIR}/weekly-cache-clear.cron"   /etc/cron.d/aero-weekly-cache-clear

# Log rotation for the updater's append-only log (SD-card lifespan).
install -m 644 "${SCRIPT_DIR}/aero-updater.logrotate"    /etc/logrotate.d/aero-updater
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

# ─── Boot branding — one held frame from power-on to live window ──────────────
#
# The Plymouth theme, the X root window and the app's BootLockup all use the
# SAME png, so the audience sees a single still image dissolve into the globe
# instead of: rainbow firmware splash -> four raspberry logos -> kernel scroll
# -> stock Plymouth -> black flash -> app. Suppressing those is the point.

if [[ -d "${SCRIPT_DIR}/branding" && "${UNITS_ONLY}" == false ]]; then
	echo "      + boot branding (Plymouth theme + quiet boot)"
	install -d -m 755 /usr/share/plymouth/themes/aero
	install -m 644 "${SCRIPT_DIR}/branding/aero.plymouth"   /usr/share/plymouth/themes/aero/aero.plymouth
	install -m 644 "${SCRIPT_DIR}/branding/aero.script"     /usr/share/plymouth/themes/aero/aero.script
	install -m 644 "${SCRIPT_DIR}/branding/aero-splash.png" /usr/share/plymouth/themes/aero/aero-splash.png
	plymouth-set-default-theme aero >/dev/null 2>&1 || true

	# Firmware rainbow splash off. Idempotent: only appended once.
	backup_boot_file /boot/firmware/config.txt
	if ! command grep -q "^disable_splash=1" /boot/firmware/config.txt 2>/dev/null; then
		printf '\n# Boot branding — suppress the firmware rainbow.\ndisable_splash=1\n' \
			>> /boot/firmware/config.txt
	fi

	# Raspberry logos, kernel scroll, console cursor off; hand over to Plymouth.
	# cmdline.txt MUST stay a single line — a stray newline makes everything
	# after it invisible to the kernel. So: slurp, dedupe, rewrite whole.
	if [[ -w /boot/firmware/cmdline.txt ]]; then
		backup_boot_file /boot/firmware/cmdline.txt
		CMDLINE="$(tr -d '\n' < /boot/firmware/cmdline.txt)"
		for tok in logo.nologo quiet loglevel=3 vt.global_cursor_default=0 splash plymouth.ignore-serial-consoles; do
			case " ${CMDLINE} " in
				*" ${tok} "*) ;;                       # already present
				*) CMDLINE="${CMDLINE} ${tok}" ;;
			esac
		done
		printf '%s\n' "${CMDLINE}" > /boot/firmware/cmdline.txt
	fi
fi

# ─── Step 7: Enable + start (idempotent — enable is a no-op on second run) ────

echo "[7/7] Enabling services..."
systemctl daemon-reload
systemctl enable aero-xserver.service aero-app.service aero-kiosk.service
systemctl enable --now aero-updater.timer

# WiFi power-save off (idempotent write).
install -d -m 755 /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/aero-no-powersave.conf <<EOF
[connection]
wifi.powersave = 2
EOF

# Screen blanking off for the kiosk session (idempotent grep-guard).
if ! grep -q "consoleblank=0" /boot/firmware/cmdline.txt 2>/dev/null; then
	backup_boot_file /boot/firmware/cmdline.txt
	sed -i 's/$/ consoleblank=0/' /boot/firmware/cmdline.txt || true
fi

echo ""
echo "============================================"
echo "  Install complete"
echo "============================================"
if [[ -d "${LEGACY_DIR}" ]]; then
	# Migrating a Pi off the pre-git layout: its old kiosk unit owns tty1/:0 via
	# its own xinit, which this layout runs as a separate aero-xserver unit.
	# Starting the new units now would fight it for the display — reboot instead.
	echo "MIGRATION: a legacy install exists at ${LEGACY_DIR}."
	echo "           REBOOT to switch over — do NOT 'systemctl start' the units"
	echo "           now, the old kiosk still holds tty1/:0."
	echo ""
	echo "Reboot:      sudo reboot"
else
	echo "Start now:   sudo systemctl start aero-xserver aero-app aero-kiosk"
	echo "Reboot:      sudo reboot"
fi
echo "Logs (app):  journalctl -u aero-app -f"
echo "Logs (X):    journalctl -u aero-kiosk -f"
echo ""
echo "Role:        ${AERO_ROLE}   Group: ${AERO_GROUP}"
echo "URL:         http://localhost:3000/?role=${AERO_ROLE}&group=${AERO_GROUP}"
