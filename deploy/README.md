# deploy/ — Raspberry Pi 5 fleet deployment

Provisioning, OTA updates, and kiosk services for the Pi 5 fleet.

**`pi/` is the canonical entry point** — see `deploy/pi/README.md`. The
installer (`deploy/pi/install.sh`) clones the repo, installs apt deps, Bun,
the systemd units (`aero-xserver`, `aero-app`, `aero-kiosk`, updater timer),
and cron jobs.

## Files in this directory

| File | Purpose |
| --- | --- |
| `pi/` | Installer, systemd units, cron jobs, branding — the live provisioning path |
| `aero-updater.sh` | OTA updater. Pulls the CI-blessed `release` branch, rebuilds, restarts services, and rolls back on install/build/health-probe failure. Invoked by `pi/aero-updater.service` (daily timer) as `/opt/zyeta-aero/app/deploy/aero-updater.sh`. |
| `aero-wifi-portal.sh` / `.service` | Boot-time WiFi check: if NetworkManager has no active connection after a 30 s grace period, starts the captive setup portal. Re-triggered by `POST /api/wifi/reset` (purge + reboot). |

## Deploy gate

The updater tracks the `release` branch, which CI fast-forwards only after
check + tests + build pass on `main` (`.github/workflows/ci.yml`). A red
commit never deploys. `release` is CI-owned — never push to it by hand.
