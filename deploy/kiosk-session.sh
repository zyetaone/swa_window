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
