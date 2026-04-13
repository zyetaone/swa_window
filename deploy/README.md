# deploy/ — Raspberry Pi 5 provisioning + OTA updater

Scripts for installing and updating Aero Dynamic Window on Raspberry Pi 5 kiosks.

**Ported from `feat/offline-tiles` → `main` on 2026-04-09.** See
`docs/port-plan-feat-offline-tiles-to-main.md` in the SWA project vault for the
full port plan (`~/Documents/projects/zyeta/W_25_SOUTHWEST_HYDERABAD/aero-window/docs/`).

---

## Files

| Script | Size | Purpose |
|---|---|---|
| `provision-pi.sh` | 10 KB | One-shot Pi 5 installer. Installs Chromium kiosk, xserver, xinit, unclutter, bun runtime. Sets up systemd services (`aero-xserver`, `aero-display`, `aero-tiles`, `aero-watchdog.timer`, `aero-updater.timer`). Pre-seeds tiles from SD card or fleet server. |
| `aero-updater.sh` | 3.7 KB | OTA updater. Runs daily via systemd timer OR on-demand. Pulls from git, runs `bun install`, rebuilds, restarts services, reports to fleet server. |

---

## Usage (display Pi — minimal)

Display Pis just run Chromium in kiosk mode pointing at a server running the
SvelteKit app. They don't self-host.

```bash
# Fresh Raspberry Pi OS 64-bit
sudo bash provision-pi.sh <SERVER_HOST> <DEVICE_NAME>

# Example: point display-01 at a fleet server on the office LAN
sudo bash provision-pi.sh aero-server.local display-01

# Reboot
sudo reboot
```

The Pi will auto-start Chromium kiosk pointing at
`http://<SERVER_HOST>:5173?device=<DEVICE_NAME>`.

---

## Usage (master Pi — runs the app)

The master Pi (or laptop, or VPS) runs the SvelteKit app that the display Pis
point at. It needs the code + bun + build + port 5173 exposed on the LAN.

```bash
# Clone the repo
sudo mkdir -p /opt/zyeta-aero
sudo chown -R $USER:$USER /opt/zyeta-aero
git clone https://github.com/zyetaone/z-aero-window.git /opt/zyeta-aero/app
cd /opt/zyeta-aero/app

# Install + build
bun install
bun run build
bun run preview --host 0.0.0.0 --port 5173

# Or run the provisioner after the clone
sudo bash deploy/provision-pi.sh localhost master-01
```

---

## Known gaps (ported as-is from feat/offline-tiles)

These are things that worked on `feat/offline-tiles` because of its monorepo
structure but need fixing on main's flat structure. They're flagged here so
you know the shape of the rough edges.

### 1. `provision-pi.sh` does NOT clone the repo

The script assumes the repo is already at `/opt/zyeta-aero/app` and copies
`aero-updater.sh` from there (`provision-pi.sh:208`). If you run the script
on a fresh Pi without a pre-existing clone, that copy step silently fails
(`2>/dev/null || true`) and the OTA updater is never installed.

**Workaround:** clone the repo manually before running provision-pi.sh:

```bash
sudo mkdir -p /opt/zyeta-aero
sudo chown -R $USER:$USER /opt/zyeta-aero
git clone https://github.com/zyetaone/z-aero-window.git /opt/zyeta-aero/app
cd /opt/zyeta-aero/app
sudo bash deploy/provision-pi.sh <SERVER_HOST> <DEVICE_NAME>
```

**Proper fix:** add a `git clone` step to provision-pi.sh. Deferred to Phase 5
of the port plan.

### 2. `provision-pi.sh` inline tile-server stub should be replaced by real `tile-server/`

The script creates `aero-tiles.service` and an inline `/opt/zyeta-aero/tile-server/index.ts`
Bun app (provision-pi.sh lines ~240-270). This inline stub is now **superseded** by the
real tile server at `tile-server/` in the repo root.

**Real tile server:** `tile-server/src/index.ts` — a Bun HTTP server (default port 8888)
that serves pre-downloaded tiles from `TILE_DIR` (default `/opt/zyeta-aero/tiles`). Supports
CORS, immutable caching, CesiumTerrainProvider-compatible `layer.json`, and a `/health`
endpoint used by `CesiumViewer.svelte` to auto-detect offline mode.

**To use offline tiles on a Pi:**
1. Pre-download tiles: `bun run tile-packager/src/index.ts --locations hyderabad,dallas --output /opt/zyeta-aero/tiles`
2. Start the tile server: `TILE_DIR=/opt/zyeta-aero/tiles bun run tile-server/src/index.ts`
3. Set `VITE_TILE_SERVER_URL=http://localhost:8888` in the display's `.env`
4. CesiumViewer auto-detects the local server via `/health` probe and uses offline tiles

**Remaining work:** update `provision-pi.sh` to launch `tile-server/src/index.ts` from
the repo instead of writing the inline stub. The `aero-tiles.service` systemd unit should
point at `tile-server/src/index.ts` with `TILE_DIR` and `TILE_PORT` env vars. This is a
follow-up refactor — not done in this port to avoid breaking the provisioner.

### 3. `aero-updater.sh` was wrapped in a `packages/display/package.json` check

Fixed in this commit. The original script (from `feat/offline-tiles`)
conditionally built only if `packages/display/package.json` existed — on main's
flat structure that check fails and the build is silently skipped, leaving the
Pi with unbuilt source after every OTA pull.

**Fix:** the check is now `if [[ -f "package.json" ]] && grep -q '"build"' package.json`,
which works on both flat and monorepo layouts.

### 4. Fleet server integration assumes a separate fleet server app

`aero-updater.sh:81-87` reports update status to `http://${FLEET_SERVER}:3001/api/health`
— a separate fleet management server that lives in `packages/server/` on
feat/offline-tiles. That package doesn't exist on main yet — it's Phase 3 of
the port.

**Effect:** the fleet server reporting is a no-op (`|| true` swallows errors)
until Phase 3 is complete. OTA still works, the Pi just doesn't report.

### 5. No `/admin` route to control the Pis

Phase 3 of the port brings the `/admin` fleet control panel from
feat/offline-tiles into main. Until then, there's no remote control — each Pi
runs autonomously from whatever state it was provisioned with, and location /
weather / config changes require an OTA pull.

---

## Migration checklist (Phase 3-5 of the port plan)

Items to land before this is production-ready for SWA Hyderabad:

- [ ] Add `git clone` step to provision-pi.sh (remove the manual pre-clone requirement)
- [x] Port `packages/server/` → `server/` (fleet server) — Phase 3
- [x] Port `packages/admin/` → `src/routes/admin/` — Phase 3
- [x] Port `packages/shared/` → `src/lib/shared/` — Phase 3
- [x] Port `packages/tile-packager/` → `tile-packager/` — Phase 4
- [x] Port `packages/tile-server/` → `tile-server/` — Phase 4 (replaces the inline version in provision-pi.sh)
- [x] Port static assets (`boeing_737` model, cloud textures, service worker) — Phase 4
- [ ] End-to-end Pi 5 validation — Phase 5

See `~/Documents/projects/zyeta/W_25_SOUTHWEST_HYDERABAD/aero-window/docs/port-plan-feat-offline-tiles-to-main.md` for full details.

---

## Troubleshooting

**`aero-display.service` fails to start:**
```bash
sudo journalctl -u aero-display -f
```

**`aero-updater.service` ran but nothing updated:**
```bash
sudo tail -50 /var/log/aero-updater.log
# Check: is the repo actually at /opt/zyeta-aero/app? Does it have a package.json?
```

**Chromium keeps restarting:**
```bash
# The watchdog might be fighting with a crash loop
sudo systemctl status aero-watchdog.timer aero-display.service
```

**`bun install --frozen-lockfile` fails:**
The updater falls back to `bun install` without `--frozen-lockfile`. If the
lockfile is genuinely broken, manually `rm bun.lock && bun install` and commit
the new lockfile.
