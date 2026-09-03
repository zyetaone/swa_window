#!/usr/bin/env bash
#
# ship-tiles — copy a verified tile pack onto a device, and prove it arrived.
#
# This exists because nothing else does it. `data/` is gitignored and the fleet
# updater tracks a git branch, so the archive reaches a Pi only by SD image or
# by a copy someone runs by hand — and a pack that never arrives looks exactly
# like a working one in every check that runs on a laptop.
#
#   bash tools/ship-tiles.sh pi@aero-display-00.local
#   bash tools/ship-tiles.sh pi@10.0.0.31 --dir /opt/aero-window/data/tiles
#
# What it does that `rsync -a` alone does not:
#
#   1. Refuses to ship a pack that is already broken. Sending a known-bad
#      archive over a slow link and discovering it at the far end is the
#      expensive version of this mistake.
#   2. Excludes build INPUT. `terrarium/` is 3.6 GB that pack-pmtiles reads to
#      make the DEM; the kiosk never requests it. Shipping it would nearly
#      double the transfer for nothing, and it is the single biggest thing in
#      the directory.
#   3. Verifies at the far end by asking the DEVICE, not by trusting rsync's
#      exit code. `/api/tiles/health` is the only thing that knows whether the
#      running server can see what was copied.
#
# Deliberately rsync-over-ssh rather than anything cleverer: the fleet has no
# artifact store, the packs change rarely, and `--partial --append-verify` over
# a flaky wall LAN is worth more than an elegant delivery mechanism nobody has
# built yet. If OTA tile deltas ever land (ADR-002 lists them as an open
# question), this becomes the manual fallback rather than the only route.

set -euo pipefail

TARGET="${1:-}"
REMOTE_DIR="/opt/aero-window/data/tiles"
LOCAL_DIR="data/tiles"
PORT=3000
DRY_RUN=""

shift || true
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dir) REMOTE_DIR="$2"; shift 2 ;;
		--from) LOCAL_DIR="$2"; shift 2 ;;
		--port) PORT="$2"; shift 2 ;;
		--dry-run) DRY_RUN="--dry-run"; shift ;;
		*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
done

if [[ -z "$TARGET" ]]; then
	cat >&2 <<'USAGE'
usage: bash tools/ship-tiles.sh <user@host> [--dir REMOTE] [--from LOCAL] [--port N] [--dry-run]

  <user@host>   the device, e.g. pi@aero-display-00.local
  --dir         where TILE_DIR points on the device (default /opt/aero-window/data/tiles)
  --from        local pack to send (default data/tiles)
  --port        app port for the health check (default 3000)
USAGE
	exit 2
fi

# ── 1. Is the pack worth shipping? ────────────────────────────────────────────
#
# The same assets REQUIRED_TILE_ASSETS names, checked the same way: content, not
# mere existence. An empty gibs/ and a zero-byte terrain.pmtiles both exist and
# both draw nothing.
missing=()
[[ -d "$LOCAL_DIR/gibs" && -n "$(ls -A "$LOCAL_DIR/gibs" 2>/dev/null)" ]] || missing+=("gibs")
[[ -s "$LOCAL_DIR/terrain.pmtiles" ]] || missing+=("terrain.pmtiles")
[[ -d "$LOCAL_DIR/viirs" && -n "$(ls -A "$LOCAL_DIR/viirs" 2>/dev/null)" ]] || missing+=("viirs")
[[ -d "$LOCAL_DIR/sentinel2" && -n "$(ls -A "$LOCAL_DIR/sentinel2" 2>/dev/null)" ]] || missing+=("sentinel2")

fatal=0
for m in "${missing[@]:-}"; do
	[[ "$m" == "gibs" || "$m" == "terrain.pmtiles" ]] && fatal=1
done

if [[ ${#missing[@]} -gt 0 ]]; then
	echo "local pack is incomplete: ${missing[*]}" >&2
	if [[ $fatal -eq 1 ]]; then
		echo "gibs and terrain.pmtiles are fatal — the window cannot draw a world." >&2
		echo "refusing to ship. see README > Offline tiles." >&2
		exit 1
	fi
	echo "(non-fatal: shipping anyway, the device will report 'degraded')" >&2
fi

# Sum only what is actually sent. `du --exclude` is GNU-only and this is run
# from a Mac as often as from Linux, so add up the shipped entries instead of
# subtracting the skipped ones — the portable direction.
size=0
for entry in "$LOCAL_DIR"/*; do
	base=$(basename "$entry")
	case "$base" in terrarium|_s2-*) continue ;; esac
	[[ -e "$entry" ]] || continue
	size=$(( size + $(du -sk "$entry" | cut -f1) ))
done
echo "shipping ~$(( size / 1024 )) MB to ${TARGET}:${REMOTE_DIR}"

# ── 2. Send it ────────────────────────────────────────────────────────────────
#
# --append-verify resumes a part-sent multi-gigabyte archive instead of starting
# the DEM again; --partial keeps what arrived when the link drops mid-transfer.
# Neither matters on a desk and both matter on an install LAN.
ssh "$TARGET" "mkdir -p '$REMOTE_DIR'"
rsync -a --info=progress2 --partial --append-verify $DRY_RUN \
	--exclude 'terrarium/' \
	--exclude '_s2-*/' \
	"$LOCAL_DIR"/ "$TARGET:$REMOTE_DIR"/

[[ -n "$DRY_RUN" ]] && { echo "dry run — nothing copied"; exit 0; }

# ── 3. Ask the DEVICE whether it worked ───────────────────────────────────────
#
# rsync exiting 0 says bytes moved. It does not say the running server can read
# them: TILE_DIR may point elsewhere, or the app may not have been restarted
# into a config that sees this path. Only the device's own health endpoint knows.
echo
echo "verifying via ${TARGET}:${PORT}/api/tiles/health"
health=$(ssh "$TARGET" "curl -fsS --max-time 20 http://127.0.0.1:${PORT}/api/tiles/health" 2>/dev/null || true)

if [[ -z "$health" ]]; then
	echo "could not reach the app on the device — is it running on port ${PORT}?" >&2
	echo "the files are copied; the check is what failed." >&2
	exit 1
fi

echo "$health"
case "$health" in
	*'"status":"ok"'*)       echo "OK — the device can draw the world."; exit 0 ;;
	*'"status":"degraded"'*) echo "DEGRADED — see missing[] above."; exit 0 ;;
	*)                       echo "ERROR — the device still cannot draw the world." >&2
	                         echo "check TILE_DIR in /etc/aero/config.env points at ${REMOTE_DIR}." >&2
	                         exit 1 ;;
esac
