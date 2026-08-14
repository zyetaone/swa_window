#!/usr/bin/env bash
# =============================================================================
# display-dim-schedule.sh — evening/morning backlight control.
#
# Called by cron at 02:00 (dim to 5%) and 06:00 (restore to 100%), and at
# @reboot with `auto` to re-assert whichever state the clock says it should be.
# Tries ddcutil first (external DDC/CI display), then sysfs backlight.
#
# ─── WHY `auto` EXISTS ───────────────────────────────────────────────────────
# The dim state is STICKY ACROSS REBOOTS: ddcutil writes VCP 0x10 into the
# monitor's own NVRAM, so a panel dimmed to 5% comes back at 5% after a power
# cycle. With only the two timed entries there was no path back to bright
# except the 06:00 cron firing exactly once — miss it and the wall sits at 5%
# all day, in an office, with no self-heal and nothing reporting it.
#
# It is easy to miss. The nightly reboot is at 04:00, INSIDE the dim window;
# a Pi powered off overnight, a clock that has not reached NTP yet, or one
# failed cron run all land in the same place. `@reboot ... auto` closes it:
# every boot re-asserts the correct state for the current hour.
#
# Usage:
#   display-dim-schedule.sh dim       # set ~5%
#   display-dim-schedule.sh bright    # set 100%
#   display-dim-schedule.sh auto      # dim if 02:00-05:59, else bright
# =============================================================================

set -u

MODE="${1:-bright}"

# Resolve `auto` against the wall clock. Window is [02:00, 06:00) — the same
# bounds as the two cron entries, kept in sync by hand; if you move either
# cron time, move this. 10# forces base-10 so `08`/`09` are not read as octal.
if [[ "${MODE}" == "auto" ]]; then
	HOUR="$(date +%H)"
	if (( 10#${HOUR} >= 2 && 10#${HOUR} < 6 )); then MODE="dim"; else MODE="bright"; fi
	echo "[display-dim] auto → ${MODE} (hour=${HOUR})"
fi

case "${MODE}" in
	dim)    DDC_VAL=5;   SYSFS_FRAC="0.05" ;;
	bright) DDC_VAL=100; SYSFS_FRAC="1.0"  ;;
	*) echo "Usage: $0 {dim|bright|auto}" >&2; exit 1 ;;
esac

# ─── Try ddcutil (DDC/CI external display brightness) ────────────────────────

if command -v ddcutil >/dev/null 2>&1; then
	# VCP 0x10 is the standard "brightness" register. ddcutil exits non-zero
	# if no DDC display is detected — we fall through to sysfs in that case.
	if ddcutil setvcp 0x10 "${DDC_VAL}" >/dev/null 2>&1; then
		echo "[display-dim] ddcutil → brightness=${DDC_VAL}"
		exit 0
	fi
fi

# ─── Fallback: /sys/class/backlight/*/brightness ─────────────────────────────

for BL in /sys/class/backlight/*; do
	[[ -d "${BL}" ]] || continue
	MAX_FILE="${BL}/max_brightness"
	CUR_FILE="${BL}/brightness"
	[[ -r "${MAX_FILE}" && -w "${CUR_FILE}" ]] || continue

	MAX="$(cat "${MAX_FILE}" 2>/dev/null || echo 0)"
	[[ "${MAX}" -gt 0 ]] || continue

	# awk integer math — no bc dependency.
	NEW="$(awk -v max="${MAX}" -v f="${SYSFS_FRAC}" 'BEGIN { v = int(max * f); if (v < 1) v = 1; print v }')"
	if echo "${NEW}" > "${CUR_FILE}" 2>/dev/null; then
		echo "[display-dim] ${BL} → ${NEW}/${MAX}"
		exit 0
	fi
done

# Not fatal — not every Pi has an addressable backlight. Just log and move on.
echo "[display-dim] no addressable brightness control found (mode=${MODE})" >&2
exit 0
