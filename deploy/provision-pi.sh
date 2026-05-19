#!/usr/bin/env bash
# =============================================================================
# Zyeta Aero — Pi 5 Provisioning Script
#
# Sets up a Raspberry Pi 5 as an Aero Dynamic Window kiosk display.
# Run as root: sudo bash provision-pi.sh [DEVICE_NAME]
#
# Architecture: Single Bun process serves SvelteKit + WebSocket fleet hub
# on one port (5173). No separate fleet or tile server.
#
# Prerequisites: Fresh Raspberry Pi OS (64-bit, Bookworm/Trixie)
# =============================================================================

set -euo pipefail

DEVICE_NAME="${1:-aero-display-$(hostname)}"
APP_PORT=5173
INSTALL_DIR="/opt/zyeta-aero"
DISPLAY_URL="http://localhost:${APP_PORT}?device=${DEVICE_NAME}"
BUN_BIN="/home/kiosk/.bun/bin/bun"

echo "============================================"
echo "  Zyeta Aero — Pi 5 Kiosk Provisioner"
echo "============================================"
echo "Device:  ${DEVICE_NAME}"
echo "URL:     ${DISPLAY_URL}"
echo ""

# ─── 1. System Update ────────────────────────────────────────────────────────

echo "[1/6] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. Install Dependencies ─────────────────────────────────────────────────

echo "[2/6] Installing Chromium and dependencies..."
apt-get install -y -qq \
    chromium \
    xserver-xorg \
    x11-xserver-utils \
    xinit \
    unclutter \
    fonts-noto \
    fonts-noto-color-emoji \
    curl \
    git

# ─── 3. Configure GPU ────────────────────────────────────────────────────────

echo "[3/6] Configuring GPU..."

# KMS overlay for VideoCore VII
if ! grep -q "dtoverlay=vc4-kms-v3d" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtoverlay=vc4-kms-v3d" >> /boot/firmware/config.txt
fi

# GPU memory
if grep -q "^gpu_mem=" /boot/firmware/config.txt 2>/dev/null; then
    sed -i 's/^gpu_mem=.*/gpu_mem=256/' /boot/firmware/config.txt
else
    echo "gpu_mem=256" >> /boot/firmware/config.txt
fi

# CMA for Cesium WebGL
if grep -q "^dtoverlay=vc4-kms-v3d,cma-" /boot/firmware/config.txt 2>/dev/null; then
    sed -i 's/^dtoverlay=vc4-kms-v3d.*/dtoverlay=vc4-kms-v3d,cma-512/' /boot/firmware/config.txt
fi

# Disable screen blanking
if ! grep -q "consoleblank=0" /boot/firmware/cmdline.txt 2>/dev/null; then
    sed -i 's/$/ consoleblank=0/' /boot/firmware/cmdline.txt
fi

# ─── 4. Install Bun ──────────────────────────────────────────────────────────

echo "[4/6] Installing Bun runtime..."
if ! id -u kiosk &>/dev/null; then
    useradd -m -s /bin/bash kiosk
    usermod -aG video,render,input kiosk
fi
if [[ ! -x "${BUN_BIN}" ]]; then
    su - kiosk -c 'curl -fsSL https://bun.sh/install | bash'
fi

# ─── 5. Create Kiosk User + Config ───────────────────────────────────────────

echo "[5/6] Setting up kiosk..."
mkdir -p "${INSTALL_DIR}"

# Install the updater alongside the deployed app so the timer unit has a stable path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 755 "${SCRIPT_DIR}/aero-updater.sh" "${INSTALL_DIR}/aero-updater.sh"

# Kiosk config
cat > "${INSTALL_DIR}/config.env" <<EOF
DISPLAY_URL=${DISPLAY_URL}
DEVICE_NAME=${DEVICE_NAME}
PORT=${APP_PORT}
EOF

# Chromium launch script
cat > "${INSTALL_DIR}/start-kiosk.sh" <<'KIOSK_SCRIPT'
#!/usr/bin/env bash
source /opt/zyeta-aero/config.env

# Wait for X
while ! xdpyinfo -display :0 &>/dev/null; do sleep 1; done

# Disable blanking
xset -display :0 s off -dpms s noblank

# Hide cursor
unclutter -display :0 -idle 3 -root &

# Clear crash flags
CDIR="/home/kiosk/.config/chromium/Default"
mkdir -p "$CDIR"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' "$CDIR/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$CDIR/Preferences" 2>/dev/null || true

exec chromium \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --ignore-gpu-blocklist \
    --enable-gpu-rasterization \
    --enable-zero-copy \
    --use-gl=angle \
    --use-angle=gles \
    --enable-webgl \
    --no-sandbox \
    --disable-software-rasterizer \
    --autoplay-policy=no-user-gesture-required \
    --window-position=0,0 \
    "${DISPLAY_URL}"
KIOSK_SCRIPT

chmod +x "${INSTALL_DIR}/start-kiosk.sh"

# ─── 6. Systemd Services ─────────────────────────────────────────────────────

echo "[6/6] Installing systemd services..."

# X server (minimal, no desktop)
cat > /etc/systemd/system/aero-xserver.service <<EOF
[Unit]
Description=Zyeta Aero X Server
After=systemd-user-sessions.service

[Service]
Type=simple
User=kiosk
Environment=DISPLAY=:0
ExecStart=/usr/bin/xinit /bin/bash -c "sleep infinity" -- :0 -nolisten tcp vt1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# App server (SvelteKit + WebSocket fleet hub — single process)
cat > /etc/systemd/system/aero-app.service <<EOF
[Unit]
Description=Zyeta Aero App Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kiosk
Environment=PORT=${APP_PORT}
Environment=NODE_ENV=production
Environment=HOME=/home/kiosk
WorkingDirectory=${INSTALL_DIR}/app
ExecStart=/home/kiosk/.bun/bin/bun run server.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Kiosk (Chromium)
cat > /etc/systemd/system/aero-kiosk.service <<EOF
[Unit]
Description=Zyeta Aero Kiosk Display
After=aero-xserver.service aero-app.service
Wants=aero-app.service
Requires=aero-xserver.service

[Service]
Type=simple
User=kiosk
Environment=DISPLAY=:0
ExecStartPre=/bin/sleep 3
ExecStart=${INSTALL_DIR}/start-kiosk.sh
Restart=always
RestartSec=10
WatchdogSec=120

[Install]
WantedBy=multi-user.target
EOF

# Watchdog (restarts hung Chromium)
cat > /etc/systemd/system/aero-watchdog.service <<EOF
[Unit]
Description=Zyeta Aero Watchdog

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'systemctl is-active aero-kiosk.service || systemctl restart aero-kiosk.service'
EOF

cat > /etc/systemd/system/aero-watchdog.timer <<EOF
[Unit]
Description=Zyeta Aero Watchdog Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=aero-watchdog.service

[Install]
WantedBy=timers.target
EOF

# OTA updater (daily 3am)
cat > /etc/systemd/system/aero-updater.service <<EOF
[Unit]
Description=Zyeta Aero OTA Updater
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${INSTALL_DIR}/aero-updater.sh
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/aero-updater.timer <<EOF
[Unit]
Description=Zyeta Aero Daily Update

[Timer]
OnBootSec=5min
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=1800
Unit=aero-updater.service

[Install]
WantedBy=timers.target
EOF

# WiFi power save off
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/no-powersave.conf <<EOF
[connection]
wifi.powersave = 2
EOF

# Enable
systemctl daemon-reload
systemctl enable aero-xserver.service
systemctl enable aero-app.service
systemctl enable aero-kiosk.service
systemctl enable aero-watchdog.timer
systemctl enable aero-updater.timer

# Hostname
hostnamectl set-hostname "${DEVICE_NAME}"

echo ""
echo "============================================"
echo "  Provisioning complete!"
echo "============================================"
echo ""
echo "Start now:  sudo systemctl start aero-xserver aero-app aero-kiosk"
echo "Logs:       journalctl -u aero-app -f"
echo "Reboot:     sudo reboot"
