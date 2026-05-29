# Pi 5 Perf Harness — Hybrid Renderer (`/playground/three`)

Lightweight, zero-dependency skeleton for validating the Cesium + Three.js hybrid on real Raspberry Pi 5 kiosk hardware.

**ADR-004 context**: This is the concrete home for Gating Item #1 ("Pi 5 perf validation").

## Acceptance Criteria (from ADR-004)
- ≥30 fps sustained at default/cruise altitude (typical passenger view)
- ≥24 fps sustained at city approach / lower altitude (higher building + effect density)
- Cold start to first stable frame measured on actual Pi 5 hardware (kiosks reboot weekly)
- GPU memory / pressure ceiling observed
- Comparison points vs current Cesium-only baseline (when possible on the same device)

All numbers taken with production build + the exact Chromium flags used in the kiosk service:
`--kiosk --use-gl=angle --use-angle=gles --enable-webgl`

## Current Harness (Browser Console + TelemetryPanel)

The project already has excellent production telemetry (`model.telemetry` ring buffer + `measuredFps` + `TelemetryPanel` Shift+T). The harness reuses it — no reinvention.

### 1. Easiest: Use the built-in TelemetryPanel (zero code)
1. On the Pi (or dev machine), open `/playground/three`
2. Press **Shift+T** — the ring-buffer viewer appears
3. Run your scenario (cruise 90–120 s, then city approach, night with clouds, 3-Pi role changes)
4. The panel shows live p50/p95 FPS + recent frame times + event counts
5. Use the "log" button in the 3-Pi simulator or the existing telemetry export for numbers

### 2. Easy one-liner benchmark (recommended for real Pi 5 hardware)

After pasting `injectable-snippet.js` (or the block below) once:

```js
runBenchmark(180000);        // 3-minute automated run → auto-stop + summary
getLastBenchmarkCSV();       // get CSV you can paste into a spreadsheet
copyLastBenchmarkCSV();      // (if clipboard available) copies it directly
```

The helpers reuse the production `model.telemetry` ring buffer, so the p50/p95 numbers are the exact same ones the HUD shows.

Manual `stopPerf()` mode is still available if you want live control.

(The full enhanced snippet with `runBenchmark` lives in `injectable-snippet.js`.)

  console.log('%c[Perf] Logger active. Use stopPerf() to halt and dump.', 'color:#0af');
})();
```

Run `stopPerf()` (or the global) when finished.

### Recommended Pi 5 Test Matrix
- Cold boot → first stable frame (target measured separately via boot logs + first RAF)
- Cruise altitude, clear, default location (Hyderabad for SWA parity)
- City approach (lower alt, dense buildings + car-lights + edges)
- Night + high cloud density (VIIRS + artistic layers stress)
- 3-Pi roles (left/center/right) if multi-device hardware available
- 2–3 minute sustained windows per condition

Record (in addition to the logger output):
- `vcgencmd measure_temp` and GPU freq during run
- `chrome://gpu` or `chrome://tracing` snapshot (if remote debugging enabled)
- Any visible hitches, tearing, or dropped frames noted by eye

## On Real Pi 5 Kiosk
1. Build the production bundle on your machine: `bun run build`
2. Deploy to the Pi (rsync / scp / the existing OTA path)
3. Restart the kiosk service so it loads the new bundle
4. SSH in (or use the existing debug overlay / remote debugging port)
5. Open the page (or it is already running in kiosk)
6. If you need a console: enable Chromium remote debugging or use a temporary dev overlay that exposes the model
7. Paste the logger or simply watch Shift+T TelemetryPanel for 2–3 minutes per scenario
8. Note the numbers against the acceptance criteria above

## Future Automation (when hardware time)
- Add a tiny playwright / puppeteer script here that drives the preview build and scrapes the telemetry via CDP
- Output CSV + summary JSON for regression tracking
- Compare hybrid vs pure-Cesium baseline on the exact same Pi 5 unit

## Files in this folder
- `README.md` — this file (living protocol + checklist)
- `hybrid-perf.ts` — Bun helper (prints checklist + current best snippet)
- `injectable-snippet.js` — the exact copy-paste JS (single source of truth)

See ADR-004 (section "Gating checklist" and the 2026-05 perf notes) for full context.

All of this is intentionally small and deletable once the hardware validation pass is complete.
