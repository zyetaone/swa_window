#!/usr/bin/env bash
# =============================================================================
# Zyeta Aero — Pi 5 Provisioning Script
#
# Sets up a Raspberry Pi 5 as an Aero Dynamic Window kiosk display.
# Run as root: sudo bash provision-pi.sh [SERVER_HOST] [DEVICE_NAME]
#
# Prerequisites: Fresh Raspberry Pi OS (64-bit Lite or Desktop)
# =============================================================================

set -euo pipefail

SERVER_HOST="${1:-aero-server.local}"
DEVICE_NAME="${2:-aero-display-$(hostname)}"
DISPLAY_URL="http://${SERVER_HOST}:5173?device=${DEVICE_NAME}"
INSTALL_DIR="/opt/zyeta-aero"

echo "============================================"
echo "  Zyeta Aero — Pi 5 Kiosk Provisioner"
echo "============================================"
echo "Server:  ${SERVER_HOST}"
echo "Device:  ${DEVICE_NAME}"
echo "URL:     ${DISPLAY_URL}"
echo ""

# ─── 1. System Update ────────────────────────────────────────────────────────

echo "[1/7] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. Install Dependencies ─────────────────────────────────────────────────

echo "[2/7] Installing Chromium and dependencies..."
apt-get install -y -qq \
    chromium-browser \
    xserver-xorg \
    x11-xserver-utils \
    xinit \
    unclutter \
    fonts-noto \
    fonts-noto-color-emoji

# ─── 3. Configure GPU ────────────────────────────────────────────────────────

echo "[3/7] Configuring GPU settings..."

# Ensure KMS overlay for VideoCore VII
if ! grep -q "dtoverlay=vc4-kms-v3d" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtoverlay=vc4-kms-v3d" >> /boot/firmware/config.txt
fi

# Increase GPU memory allocation
if grep -q "^gpu_mem=" /boot/firmware/config.txt 2>/dev/null; then
    sed -i 's/^gpu_mem=.*/gpu_mem=256/' /boot/firmware/config.txt
else
    echo "gpu_mem=256" >> /boot/firmware/config.txt
fi

# ─── 4. Create Kiosk User ────────────────────────────────────────────────────

echo "[4/7] Setting up kiosk user..."
if ! id -u kiosk &>/dev/null; then
    useradd -m -s /bin/bash kiosk
    usermod -aG video,render,input kiosk
fi

# ─── 5. Create Install Directory ─────────────────────────────────────────────

echo "[5/7] Creating configuration..."
mkdir -p "${INSTALL_DIR}"

# Write kiosk configuration
cat > "${INSTALL_DIR}/config.env" <<EOF
# Zyeta Aero Kiosk Configuration
DISPLAY_URL=${DISPLAY_URL}
SERVER_HOST=${SERVER_HOST}
DEVICE_NAME=${DEVICE_NAME}
EOF

# Chromium kiosk launch script
cat > "${INSTALL_DIR}/start-kiosk.sh" <<'KIOSK_SCRIPT'
#!/usr/bin/env bash
# Zyeta Aero Kiosk — Chromium Launch Script

source /opt/zyeta-aero/config.env

# Wait for X server
while ! xdpyinfo -display :0 &>/dev/null; do
    sleep 1
done

# Disable screen blanking
xset -display :0 s off
xset -display :0 -dpms
xset -display :0 s noblank

# Hide cursor after 3 seconds of inactivity
unclutter -display :0 -idle 3 -root &

# Clear Chromium crash flags (prevents "restore session" prompt)
CHROMIUM_DIR="/home/kiosk/.config/chromium"
mkdir -p "${CHROMIUM_DIR}/Default"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/' \
    "${CHROMIUM_DIR}/Default/Preferences" 2>/dev/null || true
sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' \
    "${CHROMIUM_DIR}/Default/Preferences" 2>/dev/null || true

# Launch Chromium in kiosk mode with GPU flags
exec chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI \
    --check-for-update-interval=31536000 \
    --ignore-gpu-blocklist \
    --enable-gpu-rasterization \
    --enable-zero-copy \
    --use-gl=egl \
    --disable-software-rasterizer \
    --enable-features=VaapiVideoDecoder \
    --disable-background-networking \
    --disable-component-update \
    --autoplay-policy=no-user-gesture-required \
    --window-size=1920,1080 \
    --window-position=0,0 \
    "${DISPLAY_URL}"
KIOSK_SCRIPT

chmod +x "${INSTALL_DIR}/start-kiosk.sh"

# ─── 6. Install systemd Services ─────────────────────────────────────────────

echo "[6/7] Installing systemd services..."

# X server service (minimal, no desktop environment)
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

# Chromium kiosk service
cat > /etc/systemd/system/aero-display.service <<EOF
[Unit]
Description=Zyeta Aero Display Kiosk
After=aero-xserver.service network-online.target
Wants=network-online.target
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
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
EOF

# Watchdog timer — restarts if Chromium is hung
cat > /etc/systemd/system/aero-watchdog.service <<EOF
[Unit]
Description=Zyeta Aero Watchdog
After=aero-display.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'systemctl is-active aero-display.service || systemctl restart aero-display.service'
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

# Enable services
systemctl daemon-reload
systemctl enable aero-xserver.service
systemctl enable aero-display.service
systemctl enable aero-watchdog.timer

# ─── 7. Set Hostname ─────────────────────────────────────────────────────────

echo "[7/7] Setting hostname to ${DEVICE_NAME}..."
hostnamectl set-hostname "${DEVICE_NAME}"

echo ""
echo "============================================"
echo "  Provisioning complete!"
echo "============================================"
echo ""
echo "The display will auto-start on next boot."
echo "To start now:  sudo systemctl start aero-xserver && sudo systemctl start aero-display"
echo "To check logs: journalctl -u aero-display -f"
echo ""
echo "Reboot recommended: sudo reboot"
