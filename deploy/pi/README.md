# deploy/pi/ — Raspberry Pi 5 deployment

Idempotent kiosk deployment for the Aero Dynamic Window corridor prototype
(3 Pis × 2 corridors = 6 devices). Distinct from the legacy `deploy/*.sh`
scripts in the parent directory — those remain for the single-Pi dev workflow.

## One-shot install

From a fresh Raspberry Pi OS Bookworm (64-bit) image with network:

```bash
curl -fsSL https://raw.githubusercontent.com/zyetaone/z-aero-window/playground/maplibre-app/deploy/pi/install.sh \
	| sudo bash -s -- --role left --group corridor-a
```

Or locally from a checkout on the Pi:

```bash
sudo bash deploy/pi/install.sh --role center --group corridor-a
```

Arguments:

| Flag | Values | Default |
| --- | --- | --- |
| `--role` | `left` / `center` / `right` / `solo` | `solo` |
| `--group` | any string, shared by the Pis that form one panorama | `default` |
| `--branch` | git branch to deploy | `playground/maplibre-app` |

The installer is fully idempotent — rerun it to upgrade packages, pull the
latest branch, rebuild, and regenerate systemd units. It never deletes data.

## Files

| File | Purpose |
| --- | --- |
| `install.sh` | Top-level installer. Clones repo, installs apt deps, Bun, systemd units, cron jobs. |
| `aero-xserver.service` | Minimal X on tty1, no desktop. |
| `aero-app.service` | `bun run build && bun run start` in the install dir. |
| `aero-kiosk.service` | Chromium kiosk pointed at the local app. |
| `health-check.sh` | Cron-driven 60s heartbeat → `POST /api/fleet/heartbeat` on the admin. |
| `display-dim-schedule.sh` | 02:00 dim to 5%, 06:00 restore to 100%. ddcutil or sysfs backlight. |
| `nightly-reboot.cron` | 04:00 reboot (between dim and bright windows). |
| `weekly-cache-clear.cron` | Sunday 03:00 shader/GPU cache clear. Preserves tile cache. |

## Kiosk URL

The kiosk launches Chromium against:

```
http://localhost:3000/playground?role=${AERO_ROLE}&group=${AERO_GROUP}
```

Role assignment follows the Phase 7 parallax protocol described in
`CLAUDE.md` — `left|center|right|solo`, with `center` as the autopilot leader
and `left`/`right` as followers.

## Admin URL for heartbeat

`health-check.sh` reads `AERO_ADMIN_URL` from `/etc/aero/config.env`. Edit
that file (or regenerate via `install.sh`) to set the admin host. If unset,
heartbeats are silently discarded — useful for bench testing a lone Pi.

## Clean shutdown

All systemd units use `Restart=always` with `TimeoutStopSec=15` and do NOT
set `ExecStop=/bin/kill -9`. Shutdown waits up to 15s for Chromium to tear
down GPU contexts and Bun to drain its connections. This is important on
the Pi 5: killing Chromium mid-WebGL leaves zombie GPU memory that the next
boot has to garbage-collect.

## Maintenance schedule (cron)

| When | What |
| --- | --- |
| Every 60s | Health POST to admin (`/api/fleet/heartbeat`) |
| Daily 02:00 | Dim display to 5% (office after-hours) |
| Daily 04:00 | Reboot |
| Daily 06:00 | Restore display to 100% |
| Sunday 03:00 | Clear Chromium shader/GPU cache (preserves tile cache) |
