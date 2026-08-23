# P8 — Pi 5 Perf Gate Checklist

> ## ⚠ STATUS: the flip already happened. This gate never ran.
>
> `config-tree.svelte.ts` has shipped `useThreeOverlay: true` since **2026-07-27**
> (`bceb86f`, a *"chore: commit in-progress lab/lighting refactor"* that swept the
> flag along with unrelated work). It is on `origin/release`, so the fielded Pis
> have been running the overlay since then. Nothing below was filled in, and the
> §5 GO precondition — confirm the `/api/config` PATCH rollback lever reaches
> 100 % of the fleet — was never checked either.
>
> Two things make that riskier than it sounds, both noted in the flipping commit
> itself: the liveness watchdog treats only `fps <= 0` as dead, so a Pi grinding
> at 8 fps is **neither detected nor recovered**; and none of the escape hatches
> (`?overlay=0`, the SidePanel toggle, a fleet `config_patch`) survive a reboot,
> because the flag is not in `PersistedState`.
>
> **Decision (2026-08-14): keep the overlay on and backfill this gate from field
> telemetry** rather than flip back and lose the night/dawn quality that won the
> Jul-8 visual A/B. See §7 — that path needs a collector, which is why
> `AERO_ADMIN_URL` now has an install-time override.

The single go/no-go for flipping `config.world.useThreeOverlay` to `true` by
default (ADR-004). Run this **on real Pi 5 kiosk hardware** — SwiftShader / dev
machines can't answer it. The whole question: *can a Pi 5 sustain Cesium + the
Three overlay together at frame budget?*

Acceptance (from ADR-004 / `README.md`):
- **≥ 30 fps** sustained at cruise (default altitude)
- **≥ 24 fps** sustained at city approach (low altitude, high building/effect density)

---

## 0. Prep (on the Pi)

- [ ] `bun run start` (production build + serve — NOT `bun run dev`; dev is unoptimised and skips the route-split, minified output the kiosk actually ships)
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
- [ ] **Over the deck** (`?location=clouds&weather=cloudy&time=13`) — open sky
      above, an unbroken cloud floor below, no hard-edged billboard quads. This
      show is IN the rotation and has never been seen on a real GPU: it was
      authored and test-pinned but the desktop check was inconclusive (RAF
      throttled to 0 fps in every capture, and the control scene rendered wrong
      too). Cloud COST needs no separate run — monsoon-mumbai already ships
      104-127 clusters against this show's 92-127, at a comparable daylit hour.
      It is the LOOK that is unverified. If it reads wrong, the fix is the hour
      or the weather in `content/shows/midday-clouds.show.ts` — no renderer
      change, and `cloudy` was chosen over `overcast` deliberately (overcast
      carries rainOpacity 0.18 + filterBrightness 0.9, i.e. the view from
      inside weather).

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

---

## 7. Backfill from the field (the chosen path — §0-5 are the bench alternative)

The overlay has been live on real hardware for weeks. That is *better* evidence
than a bench run — it covers real thermals, real tile latency, real 24 h cycles,
and the actual client-site enclosure. It only needs somewhere to accumulate.

**Why this needs setting up at all:** `AERO_ADMIN_URL` defaults to
`http://localhost:${AERO_PORT}`, so each Pi POSTs its heartbeat to *itself*. The
store is per-server, so three Pis produce three private histories and no fleet
view. Every device looks healthy on its own page while the aggregate does not
exist.

### 7.1 Stand up a collector (one-time)

Run the app on a always-on host (not a kiosk Pi — they reboot nightly at 04:00),
then re-run the installer on each Pi with both values. An existing `config.env`
value always wins, so this is safe to re-run:

```sh
AERO_ADMIN_URL=http://<collector>:3000 \
AERO_FLEET_TOKEN=<one-shared-secret> \
  sudo bash deploy/pi/install.sh --role center --group corridor-a
```

⚠ The token must be **identical** on all three Pis *and* the collector —
`/api/fleet/heartbeat` checks one `AERO_FLEET_TOKEN` and is fail-closed, and the
installer otherwise generates a *different* one per device. Heartbeat failures
are silent by design (fire-and-forget POST), so verify once by hand:

```sh
curl -H "Authorization: Bearer <shared>" -X POST http://<collector>:3000/api/fleet/heartbeat
```

200 = wired. 401 = the tokens differ. On the collector, confirm
`AERO_HEARTBEAT_LOG` is writable — that JSONL is what survives a restart.

### 7.2 Read the gate

Wait for a full 24 h cycle (the retained window is 500 samples × 60 s ≈ 8.3 h per
device, so sample at least once per shift), then:

```sh
curl -s http://<collector>:3000/api/fleet/heartbeat?stats | jq
```

Each device returns `{ fpsP50, fpsP05, fpsMin, maxTempC, crashCount, samples,
windowMs, commit, mode }`.

**Judge against `fpsP05`, not `fpsP50`.** For an fps series the bad tail is the
*low* one — a Pi that idles at 60 and stalls to 6 under cloud load has a
flattering p95 and a damning p05. `fpsP05` is the floor 5 % of samples sit below.

| Reading | Verdict |
|---|---|
| `fpsP05 ≥ 30` on every device | GO — thresholds met under real conditions |
| `fpsP05` 24–30 | GO for approach, marginal at cruise — check `maxTempC` for throttling |
| `fpsP05 < 24`, or `fpsMin` 0 recurring | NO-GO — flip the default back |
| `maxTempC` ≥ 80 °C | thermal blocker regardless of fps |
| `crashCount` climbing | instability blocker regardless of fps |

- [ ] Collector reachable, all 3 Pis reporting (`samples` rising on each)
- [ ] 24 h of coverage captured
- [ ] `fpsP05` recorded per device, per role
- [ ] `maxTempC` under the throttle point
- [ ] Verdict written into ADR-004 + §5 above

### 7.3 Still do §4 by eye

Telemetry cannot see a square sun sprite or banded bloom. The visual-artifact
checks need a human in front of the glass — but they need no instrumentation, so
they can be done on any site visit.
