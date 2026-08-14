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
#
# ─── THE CLOCK HAS TO BE TRUSTED FIRST ───────────────────────────────────────
# `auto` runs from @reboot, which is the one moment the clock is least
# reliable: a Pi 5 keeps time across power-off only if the optional RTC
# battery is fitted, and NTP may not have landed yet on a site whose WiFi
# takes a while. Reading the hour then is a guess.
#
# So: wait a bounded spell for time sync, and if it never comes, FAIL BRIGHT.
# The two outcomes are not symmetric — a bright wall at 3am is a small
# oddity nobody is there to see, while a wall stuck at 5% through business
# hours is the exact failure this whole `auto` path was added to prevent.
# Either way the next 02:00/06:00 cron corrects it.
if [[ "${MODE}" == "auto" ]]; then
	CLOCK_OK=1
	if command -v timedatectl >/dev/null 2>&1; then
		CLOCK_OK=0
		for _ in $(seq 1 24); do   # ~120 s at 5 s intervals
			if [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" == "yes" ]]; then
				CLOCK_OK=1; break
			fi
			sleep 5
		done
	fi

	HOUR="$(date +%H)"
	if (( CLOCK_OK == 0 )); then
		MODE="bright"
		echo "[display-dim] auto → bright (clock UNSYNCED after 120s; hour=${HOUR} not trusted)"
	elif (( 10#${HOUR} >= 2 && 10#${HOUR} < 6 )); then
		MODE="dim";    echo "[display-dim] auto → dim (hour=${HOUR})"
	else
		MODE="bright"; echo "[display-dim] auto → bright (hour=${HOUR})"
	fi
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
