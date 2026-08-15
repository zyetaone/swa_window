# Pi performance — local process

**Audience:** engineers measuring or improving kiosk frame rate on Raspberry Pi 5.  
**Companion:** `docs/PERF-2026-07-27-fps-investigation.md` (measurement results).  
**Stakeholder summary:** `/wiki#perf`.

## Reality check (do not skip)

| Fact | Implication |
|------|-------------|
| Simulation tick ≈ **0.2 ms** | App logic is not the 300–500 ms frame. |
| Cutting resolution 3× barely moves fps | Do **not** drop 2560×1080 as a “perf fix.” |
| Autopilot changes city/weather | Single fps samples are **noise**. |
| Fake GL flags (`--use-gl=egl`) | Can silently disable GPU. Read Chromium GPU process argv. |

Target aspiration remains ≥50 fps; fielded wall runs ~2–4 fps today. Treat gains as relative to a **pinned scene**, not absolute vibes.

## Local process (every perf change)

### 1. Pin the scene

On the Pi (or LAN kiosk):

- Fixed `?role=solo` (or the pane under test).
- Disable autopilot (SidePanel / config `director.autopilot.enabled=false`).
- Fixed location + weather + time (admin or URL params if present).
- Prefer `qualityMode=performance` (default).
- Note Three overlay on/off (`world.useThreeOverlay`) as an A/B axis.

Record: commit hash, quality mode, overlay flag, location, time-of-day, weather.

### 2. Measure honestly

- Use telemetry `fps` / `fpsLow` (median frame period), **not** tickMs misread as fps.
- Collect **≥5** one-minute windows after a 60 s warm-up (tiles settled).
- Report median ± range. Discard first minute after location hop.

### 3. Ablate in order

1. **Postprocess** (color grade / FXAA) — biggest Cesium CPU suspects.  
2. **Buildings** SSE / maximumScreenSpaceError.  
3. **Imagery layers** (VIIRS + roads).  
4. **Three overlay** (if enabled).  
5. Only then Chromium flags (`--use-angle=…`) with GPU argv verification.

Do not ablate app tick code first — it will not move the needle.

### 4. Ship gate

```bash
bun run check
bun run test
bun run build
# optional: route smoke against production build
```

Deploy only through the **`release`** branch path (CI green → updater). Never hand-edit kiosk systemd `ExecStart` with untested GL flags.

### 5. Offline tile budget

- Confirm `/api/tiles` health reports `hasTiles: true` and expected layers.  
- Prefer baked `viirs-roads` when packaged (avoids double-glow + CDN).  
- A cold cache forces remote fetches → multi-second stalls that look like “bad fps.”

## Redundant work to avoid

| Anti-pattern | Why |
|--------------|-----|
| Lowering panel resolution | Not fill-bound; letterboxes ultrawide |
| Optimizing `$derived` / tick without a pin | 0.04 % of frame |
| Enabling ultra quality “to look better” on Pi | Trades remaining CPU for detail nobody sees at 3 fps |
| Duplicate GL “tuning” docs not tied to measured argv | Silent disable regression class |

## Thermal / power throttle control

Pi firmware already throttles clocks under heat or under-voltage — we do not
disable that. We **report** and **shed GPU work early** so Cesium is not still
pulling full load while the SoC collapses.

| Signal | Source |
|--------|--------|
| CPU °C | `/sys/class/thermal/thermal_zone0/temp` |
| Throttle bits | `vcgencmd get_throttled` (live 0–3, sticky 16–19) |
| Policy | `src/lib/fleet/throttle.ts` — shed at **≥78 °C** or any live bit; stay shed until **≤70 °C** |
| Device write | `deploy/pi/health-check.sh` → `/run/aero/thermal.json` every 60s |
| Heartbeat | `throttledRaw` + `thermalAction` → admin **Fleet health** |
| Kiosk action | `startThermalGuard` polls `/api/internal/thermal` (loopback) → local `qualityMode=performance` + `useThreeOverlay=false` |

**Does not auto-restore** higher quality when cool — operator raises from admin after the wall settles (avoids thrash).

**Not peer-synced** — one hot pane must not force the whole corridor to performance.

| Env (optional) | Default | Meaning |
|----------------|---------|---------|
| `AERO_THERMAL_SHED_C` | 78 | °C to enter shed |
| `AERO_THERMAL_CLEAR_C` | 70 | °C hysteresis clear (health-check only) |
| `AERO_THERMAL_DIR` | `/run/aero` | state directory |
| `AERO_THERMAL_STATE_PATH` | `/run/aero/thermal.json` | server read path |

Admin tiles show **SHEDding** / live UV·cap·throt flags. Summary counts `shedding` and `throttledLive`.

## Product lean decisions (2026-08)

See `docs/SIMPLIFICATION-DECISIONS.md`. Summary:

- **Wing stays on** fielded Pis (`useThreeOverlay` default true).
- **Daisy-chain:** quality + Three peer-sync and ambient-persist (whole wall).
- **Pi lean under performance:** day shadows/FXAA/AO off; **day grade pass
  off** (`qualityPaintGates` — dayContrast/dayVibrance do not keep postFx on);
  Three **cloud count** scaled by `PERFORMANCE_CLOUD_COUNT_SCALE` (wing still
  mounted). Night bloom / hash palette remain on for the city-lights look.
- **Night Lab:** enhance further (DEV `?lab=1`); not deleted until the photo
  is chosen (see SIMPLIFICATION-DECISIONS).

## Related code

- Quality presets: `src/lib/world/cesium-setup.ts` (`CESIUM_QUALITY_PRESETS`)  
- Default `qualityMode: 'performance'`: `config-tree.svelte.ts`  
- Cloud budget: `world/three/cloud-cluster-budget.ts`  
- Liveness / reload budget: `lifecycle-liveness.ts`  
- Thermal policy + guard: `src/lib/fleet/throttle.ts`, `thermal-guard.svelte.ts`  
- Credits / product owner: `src/lib/credits.ts`
