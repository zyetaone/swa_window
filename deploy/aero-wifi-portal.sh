#!/bin/bash
# aero-wifi-portal.sh — invoked at boot. Decides:
#
#   IF NetworkManager has no active WiFi connection after a grace period
#   THEN start wifi-connect (creates AP "aero-display-XX-setup", serves
#        branded portal at 192.168.42.1:80, blocks until customer completes
#        WiFi setup or 5 min timeout)
#   ELSE exit 0 quietly so the kiosk app boots normally.
#
# Re-trigger paths:
#   - /api/wifi/reset endpoint deletes saved connections + reboots → no WiFi
#     on next boot → portal mode kicks in here
#   - GPIO button hold (separate gpio-watcher.sh) does the same
set -e

# ─── Wait for NetworkManager ────────────────────────────────────────────────
# NM may take a few seconds after boot to scan + connect to known networks.
# Give it 30s before we assume "no WiFi means we need a portal".
GRACE=30
echo "[wifi-portal] waiting up to ${GRACE}s for active wifi…"

deadline=$((SECONDS + GRACE))
while [ $SECONDS -lt $deadline ]; do
  state=$(nmcli -t -f WIFI g 2>/dev/null || echo "")
  active=$(nmcli -t -f TYPE,STATE c show --active 2>/dev/null | command grep '^802-11-wireless:activated' | head -1)
  if [ -n "$active" ]; then
    echo "[wifi-portal] active wifi found: $active — exiting"
    exit 0
  fi
  sleep 2
done

# ─── No WiFi — launch portal ────────────────────────────────────────────────
HOST=$(hostname)
SSID="${HOST%-display-*}-display-${HOST##*-}-setup"
# Fallback to a generic SSID if hostname doesn't match the aero-display-XX pattern.
[ -z "${SSID%%--*}" ] && SSID="aero-display-setup"

echo "[wifi-portal] no active WiFi; spawning AP \"$SSID\""

# wifi-connect blocks until a successful connection or 5min timeout.
# The branded portal lives at /usr/local/share/wifi-portal.
exec /usr/local/bin/wifi-connect \
  --portal-ssid "$SSID" \
  --portal-passphrase "" \
  --ui-directory /usr/local/share/wifi-portal
