# P8 — Pi 5 Perf Gate Checklist

The single go/no-go for flipping `config.world.useThreeOverlay` to `true` by
default (ADR-004). Run this **on real Pi 5 kiosk hardware** — SwiftShader / dev
machines can't answer it. The whole question: *can a Pi 5 sustain Cesium + the
Three overlay together at frame budget?*

Acceptance (from ADR-004 / `README.md`):
- **≥ 30 fps** sustained at cruise (default altitude)
- **≥ 24 fps** sustained at city approach (low altitude, high building/effect density)

---

## 0. Prep (on the Pi)

- [ ] `bun run start` (production build + serve — NOT `bun run dev`; dev is unoptimised and skips the single-bundle path the kiosk actually ships)
- [ ] Chromium launched with the real kiosk flags: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- [ ] Fan attached + GPU turbo ready (thermals throttle fps within minutes without it)
- [ ] Warm the tile cache once at each test location (first pass streams tiles; measure the *second* pass so tile I/O isn't polluting fps)
- [ ] Note baseline: board temp, free RAM, `vcgencmd measure_temp`

## 1. Two ways to flip the overlay (pick one)

- **In-space toggle (new):** open the SidePanel → **"Photoreal Overlay (P8)"** — flips this device live, no reload. Best for eyeballing the A/B while standing in front of the display.
- **URL A/B (reproducible):** `/?overlay=1` vs `/?overlay=0` — pin the scenario with `?time=` / `?weather=` / `?location=` so OFF and ON runs are identical. Best for the numbers.

## 2. Instrument

- [ ] **Shift+T** for the live TelemetryPanel (p50/p95 fps + frame times), OR
- [ ] Paste `tools/perf/injectable-snippet.js` once, then `runBenchmark(180000)` (3-min auto run) → `copyLastBenchmarkCSV()`

## 3. Scenarios — run each OFF then ON, ~90–180 s each

Record p50 / p95 fps for both states:

| Scenario | How to reach it | OFF p50/p95 | ON p50/p95 | Pass? |
|---|---|---|---|---|
| **Cruise** (default alt) | `?time=14` clear, let it orbit | | | ≥30 |
| **City approach** (low alt) | `?time=21&location=hyderabad`, low orbit | | | ≥24 |
| **Night + clouds** | `?time=23&weather=cloudy` | | | ≥24 |
| **Night-city flyover beat** | wait for the beat, or set `vantage.minIntervalSec=5` in the panel | | | ≥24 during descent |
| **3-Pi role change** | flip `?role=left/center/right` | | | no tear, stable fps |

- [ ] **Cold start**: reboot, time from power-on → first stable frame (kiosks reboot weekly — this matters). Record OFF vs ON.
- [ ] **GPU memory / pressure ceiling**: watch for creep over a 10-min ON run (leak = fail).
- [ ] **Sustained ON**: leave overlay ON 15+ min — fps must not degrade (thermal throttle check).

## 4. Visual artifacts — verify on the real GPU (SwiftShader masks these)

- [ ] **Sun sprite at golden hour** (`?time=17.5`) — round glow, *not* a square SwiftShader sprite
- [ ] **Night city-light bloom** (`?time=23`) — soft halo around bright pixels, no hard banding
- [ ] **Godrays** at low sun — present, not blown out
- [ ] **Wing** — livery + nav-light strobe render clean, no z-fighting against the horizon
- [ ] **Neon roads / city bokeh** — crisp, no shimmer or moiré at cruise

## 5. Decision

- [ ] **GO** — both fps thresholds met, no leak/thermal/visual blocker.
      → **Precondition before flipping the default:** confirm `/api/config` PATCH
      reaches **100 %** of the fleet (the rollback lever must work first).
      → Then flip `config-tree.svelte.ts` `useThreeOverlay: true`, tag `pre-ship-v2`,
      then burn down the deferred debt (Cesium-side `altitudeDetailMix` migration →
      C4 wing keystone → delete the runtime-deduped DOM effects).
- [ ] **NO-GO** — default stays `false`; the hybrid keeps maturing in the lab;
      SWA Hyderabad ships Cesium-only (`pre-ship-v1`), unchanged. The overlay
      remains available per-device via the panel toggle / `?overlay=1` for demos.

## 6. Record

Paste the CSVs + the table above into the ADR-004 "Current Status" section (or a
dated note beside it) so the go/no-go is auditable. Include board temp + the
Chromium/Cesium versions the run used.
