# Aircraft Window Experiential Module

A browser-based Three.js prototype simulating an aircraft window view. It supports two modes:
1. **Circadian:** Matches local time/sun position.
2. **Interactive:** Follows a simulated flight path received via WebSockets.

## Installation

1. **Prerequisites:** Node.js v16+
2. **Install:**
   ```bash
   npm install
   ```

## Running Locally (Desktop)

1. Start the server (which also builds the frontend in memory via Vite middleware logic or serves dist):
   ```bash
   npm run dev
   ```
   (Access at `http://localhost:5173` - Note: default Vite port, ensure Socket connects to 3000. *Correction: Use the hybrid setup below*)

   **Recommended Production Simulation:**
   ```bash
   npm run build
   npm start
   ```
   Access at `http://localhost:3000`.

## Raspberry Pi Kiosk Setup

1. Flash Raspberry Pi OS (Lite or Desktop).
2. Install Node.js.
3. Clone this repo and `npm install && npm run build`.
4. Auto-start script (`/home/pi/start_window.sh`):
   ```bash
   #!/bin/bash
   cd /home/pi/aircraft-window-proto
   npm start &
   sleep 5
   export DISPLAY=:0
   chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 http://localhost:3000
   ```
5. Add to `~/.config/wayfire.ini` (if Bookworm) or `.xinitrc`.

## Controls

- **Blind Sensor:** Send POST to `/sensor` with `{"state":"closed"}`.
- **UI:** Top left contains debug toggles for Time and Mode.

## Assets
Place `window_frame.png` (1280x720 transparent center) and `wing.png` in `public/assets/`.
