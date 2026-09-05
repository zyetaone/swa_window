#!/usr/bin/env bash
# Pack the locations that have no Sentinel-2 basemap, then their water masks.
#
# Sequential on purpose: each place pulls several 100+ MB Sentinel-2 COGs and
# runs gdalwarp/gdal2tiles, so running them in parallel just thrashes the disk
# and the link. Failures are logged and skipped rather than aborting the run —
# a place with no cloud-free window in range is a real answer, not a crash.
set -u
cd "$(dirname "$0")/.." || exit 1

LOG=/tmp/pack-all.log
: > "$LOG"

say() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

for place in mumbai ocean desert; do
	if [[ -f "data/tiles/sentinel2/source-${place}.json" ]]; then
		say "SKIP ${place}: already packed"
		continue
	fi
	say "=== sentinel2: ${place} ==="
	# Wide window: monsoon (mumbai) and the tropics rarely give a clear 15-day
	# window inside the default Jan-Jun, and a basemap is seasonal-agnostic.
	if python3 tools/fetch-sentinel2.py "$place" --start 2026-01-01 --end 2026-09-01 >>"$LOG" 2>&1; then
		say "OK   sentinel2 ${place}"
	else
		say "FAIL sentinel2 ${place} (see $LOG)"
	fi
done

# Water masks need source-<place>.json from the step above, so they run second.
# chicago_midway already has one.
for place in dubai mumbai ocean; do
	if [[ -f "data/tiles/water/source-${place}.json" ]]; then
		say "SKIP water ${place}: already packed"
		continue
	fi
	if [[ ! -f "data/tiles/sentinel2/source-${place}.json" ]]; then
		say "SKIP water ${place}: no sentinel2 source to derive from"
		continue
	fi
	say "=== water: ${place} ==="
	if python3 tools/fetch-water-mask.py "$place" >>"$LOG" 2>&1; then
		say "OK   water ${place}"
	else
		say "FAIL water ${place} (see $LOG)"
	fi
done

say "=== done ==="
