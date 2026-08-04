#!/usr/bin/env bash
# =============================================================================
# health-check.sh — cron-driven Pi health report.
#
# Runs every 60s from /etc/cron.d/aero-health-check. Collects fps (from the
# local app's /api/fleet health endpoint), CPU temperature, and uptime, then
# POSTs to the admin via AERO_ADMIN_URL. If no admin is configured or the
# admin is unreachable, the script silent-fails — cron should never flood
# syslog on a cold network.
#
# Contract with admin:
#   POST ${AERO_ADMIN_URL}/api/fleet/heartbeat
#   Body: { deviceId, role, groupId, fps, temp, uptime, crashCount }
# =============================================================================

set -u

# Source config (written by install.sh). Defaults are chosen so an
# unconfigured Pi still produces sensible payloads.
if [[ -r /etc/aero/config.env ]]; then
	# shellcheck disable=SC1091
	source /etc/aero/config.env
fi

AERO_ROLE="${AERO_ROLE:-solo}"
AERO_GROUP="${AERO_GROUP:-default}"
AERO_PORT="${AERO_PORT:-3000}"
# Where the heartbeat is POSTed. Defaults to THIS device rather than empty:
# the heartbeat store is per-server and in-memory, so posting to ourselves is
# what makes this Pi's own /admin/fleet/health page work. An empty value meant
# a fresh install had no telemetry anywhere until an operator hand-edited
# config.env — and nothing surfaced that, because the POST below is
# fire-and-forget by design. Point it at a central admin to aggregate a fleet.
AERO_ADMIN_URL="${AERO_ADMIN_URL:-http://localhost:${AERO_PORT}}"
# Shared LAN secret for POST /api/fleet/heartbeat. The route is bearer-gated
# and FAIL-CLOSED: without this header every heartbeat is a 503 and the admin
# health dashboard sits permanently empty while each Pi reports success (the
# curl below swallows errors by design). Provisioned into config.env by
# install.sh.
AERO_FLEET_TOKEN="${AERO_FLEET_TOKEN:-}"
DEVICE_ID="$(hostname)"

# ─── Measurements ────────────────────────────────────────────────────────────

# Uptime in seconds (integer).
if [[ -r /proc/uptime ]]; then
	UPTIME="$(cut -d' ' -f1 /proc/uptime | cut -d'.' -f1)"
else
	UPTIME=0
fi

# CPU temperature in °C. Pi thermal_zone0 reports millidegrees.
TEMP_C=0
if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
	TEMP_MILLI="$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0)"
	TEMP_C=$(( TEMP_MILLI / 1000 ))
fi

# FPS + running commit — scrape the device's own /api/status (the browser
# heartbeats fps + build commit there every 5s). The old target,
# /api/fleet?health, never existed — WAN heartbeats reported fps 0 forever.
# If the app is down, default to 0 so the admin sees it as failing.
FPS=0
COMMIT=""
if command -v curl >/dev/null 2>&1; then
	STATUS_JSON="$(curl -fsS --max-time 2 "http://localhost:${AERO_PORT}/api/status" 2>/dev/null || echo '{}')"
	# Cheap JSON scrapes without a jq dependency.
	FPS="$(echo "${STATUS_JSON}" | tr ',' '\n' | command grep -o '"fps":[0-9.]*' | head -1 | cut -d':' -f2 || echo 0)"
	FPS="${FPS:-0}"
	COMMIT="$(echo "${STATUS_JSON}" | tr ',' '\n' | command grep -o '"commit":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
fi

# Last error line from the app service journal — one line of WHY, not just
# a crash count. Escaped for JSON embedding (quotes/backslashes stripped).
LAST_ERROR=""
if command -v journalctl >/dev/null 2>&1; then
	LAST_ERROR="$(journalctl -u aero-app.service -p err -n 1 --no-pager -o cat 2>/dev/null \
		| head -c 200 | tr -d '"\\' || true)"
fi

# Crash count — increment whenever aero-kiosk.service failed since boot.
CRASH_COUNT=0
if command -v systemctl >/dev/null 2>&1; then
	CRASH_COUNT="$(systemctl show aero-kiosk.service -p NRestarts --value 2>/dev/null || echo 0)"
	CRASH_COUNT="${CRASH_COUNT:-0}"
fi

# ─── POST to admin ───────────────────────────────────────────────────────────

PAYLOAD=$(cat <<EOF
{"deviceId":"${DEVICE_ID}","role":"${AERO_ROLE}","groupId":"${AERO_GROUP}","fps":${FPS},"temp":${TEMP_C},"uptime":${UPTIME},"crashCount":${CRASH_COUNT},"commit":"${COMMIT}","lastError":"${LAST_ERROR}"}
EOF
)

if [[ -n "${AERO_ADMIN_URL}" ]] && command -v curl >/dev/null 2>&1; then
	# Two explicit branches rather than an "${ARGS[@]}" array: this script runs
	# under `set -u`, and expanding an EMPTY array that way is an unbound-variable
	# error on bash < 4.4 (still the default /bin/bash on some hosts). A health
	# check must not be the thing that breaks on an old shell.
	if [[ -n "${AERO_FLEET_TOKEN}" ]]; then
		curl -fsS --max-time 3 -X POST \
			-H "Content-Type: application/json" \
			-H "Authorization: Bearer ${AERO_FLEET_TOKEN}" \
			-d "${PAYLOAD}" \
			"${AERO_ADMIN_URL}/api/fleet/heartbeat" >/dev/null 2>&1 || true
	else
		curl -fsS --max-time 3 -X POST \
			-H "Content-Type: application/json" \
			-d "${PAYLOAD}" \
			"${AERO_ADMIN_URL}/api/fleet/heartbeat" >/dev/null 2>&1 || true
	fi
fi

# Always exit 0 — a health check that fails the cron job just creates noise.
exit 0
