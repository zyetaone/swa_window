#!/usr/bin/env bash
# =============================================================================
# display-dim-schedule.sh — evening/morning backlight control.
#
# Called by cron at 02:00 (dim to 5%) and 06:00 (restore to 100%).
# Tries ddcutil first (external DDC/CI display), then sysfs backlight.
#
# Usage:
#   display-dim-schedule.sh dim       # set ~5%
#   display-dim-schedule.sh bright    # set 100%
# =============================================================================

set -u

MODE="${1:-bright}"
case "${MODE}" in
	dim)    DDC_VAL=5;   SYSFS_FRAC="0.05" ;;
	bright) DDC_VAL=100; SYSFS_FRAC="1.0"  ;;
	*) echo "Usage: $0 {dim|bright}" >&2; exit 1 ;;
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
