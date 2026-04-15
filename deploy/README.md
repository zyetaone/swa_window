# deploy/ — Raspberry Pi 5 provisioning + OTA updater

Scripts for bootstrapping a single Raspberry Pi 5 kiosk that serves the app locally and launches Chromium in kiosk mode.

## Files

| Script | Purpose |
| --- | --- |
| `provision-pi.sh` | Installs Chromium/X11 dependencies, writes `/opt/zyeta-aero/config.env`, installs systemd units, and copies `aero-updater.sh` into `/opt/zyeta-aero/`. Assumes the repo checkout already exists at `/opt/zyeta-aero/app`. |
| `aero-updater.sh` | Pulls the latest git revision in `/opt/zyeta-aero/app`, runs `bun install`, rebuilds the app, and restarts the local app + kiosk services. |

## Current deployment model

- One Pi runs the Bun server locally on port `5173`.
- Chromium points at `http://localhost:5173?device=<DEVICE_NAME>`.
- These scripts do **not** provision a separate fleet server or tile server.

## Current usage

```bash
sudo mkdir -p /opt/zyeta-aero
sudo chown -R $USER:$USER /opt/zyeta-aero
git clone https://github.com/zyetaone/z-aero-window.git /opt/zyeta-aero/app
cd /opt/zyeta-aero/app

bun install
bun run build

sudo bash deploy/provision-pi.sh [device-name]
sudo systemctl start aero-xserver aero-app aero-kiosk
```

`provision-pi.sh` accepts one optional argument: `DEVICE_NAME`. If omitted, it defaults to `aero-display-$(hostname)`.

## Installed services

| Service | Purpose |
| --- | --- |
| `aero-xserver.service` | Minimal X server for the kiosk user |
| `aero-app.service` | Bun runtime serving `server.ts` from `/opt/zyeta-aero/app` |
| `aero-kiosk.service` | Chromium kiosk pointed at the local app |
| `aero-watchdog.timer` | Periodic watchdog for the kiosk process |
| `aero-updater.timer` | Daily OTA update timer |

## Known caveats

1. `provision-pi.sh` does **not** clone the repo. The checkout still needs to exist at `/opt/zyeta-aero/app` before provisioning.
2. `provision-pi.sh` does **not** build the app. If `build/handler.js` is missing, `server.ts` falls back to WebSocket-only mode and the kiosk page will not render.
3. Bun installation still needs a follow-up pass: the provisioner installs Bun for the invoking user, while `aero-app.service` currently expects `/home/kiosk/.bun/bin/bun`.
4. Chromium is launched with `--no-sandbox`. Review that before using these scripts outside a trusted kiosk environment.
5. Fleet update reporting is best-effort only; the updater swallows network failures when `AERO_FLEET_SERVER` is set.

## Tile tooling status

- The current repo-local workflow is script-based: `bun run prefetch-tiles --dry-run <location>` and `bun run build-pmtiles`.
- Those scripts write local artifacts under `public/tiles` and `public/pmtiles`; they are helper outputs, not app source.
- Treat offline tile packaging as experimental until the script-based workflow is reconciled with the longer-term architecture notes in `docs/ADR-001-offline-tile-architecture.md`.

## Troubleshooting

**`aero-app.service` fails to start:**

```bash
sudo journalctl -u aero-app -f
```

**`aero-kiosk.service` keeps restarting:**

```bash
sudo systemctl status aero-kiosk.service aero-watchdog.timer
```

**`aero-updater.service` ran but nothing changed:**

```bash
sudo journalctl -u aero-updater.service -n 100
sudo tail -50 /var/log/aero-updater.log
```

**`bun install --frozen-lockfile` fails in the updater:**

The updater already falls back to `bun install` without `--frozen-lockfile`. If the lockfile itself is broken, regenerate it locally and commit the new `bun.lock`.
