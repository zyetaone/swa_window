#!/bin/bash
# Optional: GPIO button to trigger WiFi reset.
#
# Wire a momentary button between GPIO17 (BCM, physical pin 11) and GND.
# Hold for 5 seconds → wipes saved WiFi profiles + reboots → next boot
# enters portal mode.
#
# Uses gpiod (libgpiod-tools) — modern Linux GPIO interface.
# Install once: sudo apt-get install -y gpiod
#
# To enable: copy aero-gpio-reset.service to /etc/systemd/system/ + enable.

set -e
BUTTON_PIN=${BUTTON_PIN:-17}
HOLD_SECONDS=${HOLD_SECONDS:-5}
GPIO_CHIP=${GPIO_CHIP:-/dev/gpiochip0}

echo "[gpio-reset] watching gpiochip0 line $BUTTON_PIN, hold ${HOLD_SECONDS}s to reset"

while true; do
  # gpiomon blocks until the line goes LOW (button pressed against GND).
  gpiomon --num-events=1 --falling-edge --bias=pull-up --silent "$GPIO_CHIP" "$BUTTON_PIN"
  start=$SECONDS
  # Poll line state — if user releases before HOLD_SECONDS, abort.
  while [ "$(gpioget --bias=pull-up "$GPIO_CHIP" "$BUTTON_PIN" 2>/dev/null)" = "0" ]; do
    elapsed=$((SECONDS - start))
    if [ $elapsed -ge "$HOLD_SECONDS" ]; then
      echo "[gpio-reset] held ${elapsed}s — initiating WiFi reset + reboot"
      curl -s -X POST http://localhost:5173/api/wifi/reset || true
      sleep 5
      break
    fi
    sleep 0.5
  done
done
