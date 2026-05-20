#!/bin/bash
# X session entrypoint for aero-kiosk.service.
#
# Runs as the X-session command (after `xinit ...`) and:
#   - hides cursor with unclutter (any source: HID move, browser hover)
#   - persists Chromium's HTTP cache between restarts at /home/pi/.cache/aero-tiles
#     (2 GB cap — keeps ~10k tiles warm across kiosk reboots)
#   - launches Chromium full-screen against the local app server
#
# Installed at /home/pi/aero-window/deploy/kiosk-session.sh during provision.
set -e

# Hide cursor as soon as it stops moving (0.1s idle).
unclutter -idle 0.1 -root &

mkdir -p /home/pi/.cache/aero-tiles

# --no-sandbox: required on Pi 5 Bookworm with Chromium's default AppArmor
# profile, which denies the user-namespace sandbox. The kiosk browses only
# localhost (the Bun server on :5173) with no user-facing keyboard/mouse
# beyond the shift-T telemetry toggle — attack surface is the LAN-posted
# admin REST endpoints (authenticated).
#
# Mitigations:
#   - Network-isolate the Pi VLAN if the physical environment permits.
#   - On Pi OS releases where user namespaces are enabled, remove this flag
#     and test Cesium rendering (WebGL may need --enable-webgl + --ignore-gpu-blocklist).
#   - Ensure AERO_ADMIN_TOKEN is set in /opt/zyeta-aero/config.env.
#
# Refs: https://chromium.googlesource.com/chromium/src/+/main/docs/linux/sandboxing.md
exec /usr/bin/chromium \
  --kiosk \
  --noerrdialogs --disable-infobars \
  --ignore-gpu-blocklist --enable-gpu-rasterization \
  --use-gl=angle --use-angle=gles --enable-webgl \
  --no-sandbox --disable-gpu-driver-bug-workarounds \
  --autoplay-policy=no-user-gesture-required \
  --disk-cache-size=2147483648 \
  --disk-cache-dir=/home/pi/.cache/aero-tiles \
  http://localhost:5173
