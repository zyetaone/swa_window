# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view synced to time of day, designed for Raspberry Pi 5 fleet deployment with headless Chromium kiosk mode.

**Active branch:** `main`. Ship-stack is **Cesium v1** — globe, terrain, buildings, VIIRS night-lights, and the post-process color-grade pipeline all live in `src/lib/world/` and are the production renderer for the SWA Hyderabad install (SATTVA Knowledge Park). The MapLibre + PMTiles + Takram three-geospatial path explored earlier is **archived** — the takram recipe survives in `docs/reference/takram-atmosphere-recipe.md` for future revisit. Cesium remains isolated to `src/lib/world/` (only `world/CesiumViewer.svelte` does the runtime import; the rest of the codebase is framework-free and unit-testable).

**Hybrid Three.js overlay (`src/lib/world-three/`, Phase 16-17) is LAB-ONLY.** A transparent Three.js canvas mounted above Cesium on `/playground/three` — clouds, the SWA wing, sky-extras (Moon, stars, sun-glow, meteors), neon city lines, and a full postprocessing chain. It is the R&D surface for photoreal effects; the ship route `/` renders Cesium only. ⚠ `compose.ts`, `flight.svelte.ts`, and `config-tree.svelte.ts` are SHARED — editing them affects both the lab and the ship.

## Commands

```bash
bun run dev          # Start development server (Vite, binds 0.0.0.0 for LAN)
bun run build        # Build for production (single-bundle for Pi)
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run check:watch  # Type check in watch mode
bun run test         # Run unit/integration tests (alias: bun x vitest run)
bun x vitest run tests/lib/world-three/sky.test.ts   # Run a single test file
bun x vitest run -t "memoises sun direction"          # Run tests matching a name
bun run serve        # Full LAN server via Bun (server.ts — starts mDNS peer discovery)
bun run start        # build + serve (production-like, what the Pi runs)
```

`bun run dev` (Vite) skips mDNS, so `/api/devices` only ever shows self; use `bun run serve` to exercise real fleet discovery.

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable()`, `createContext` on 5.40+)
- **Terrain + globe**: Cesium (production). Confined to `src/lib/world/`; only `compose.ts`/`cesium-setup.ts` import the package as a type, only `CesiumViewer.svelte` does the runtime `import('cesium')`.
- **Imagery**: EOX Sentinel-2 Cloudless (day) + NASA VIIRS Black Marble (night). The CartoDB Dark overlay was dropped in Phase 15.5 — the post-process shader's `mix()` to navy now carries the atmospheric darkening the CartoDB layer used to provide. Pre-packaged offline via `tools/tile-packager/` into `TILE_DIR`. Falls back to remote sources only on cache miss.
- **Atmosphere**: SVG feTurbulence clouds, CSS rain/frost/lightning, procedural micro-events.
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks.
- **State**: Flat reactive `$state` objects in `src/lib/model/config-tree.svelte.ts` — one per namespace (atmosphere, camera, director, world, shell). No class-per-namespace. Fleet v2 protocol routes path-targeted patches through `model.applyConfigPatch(path, value)`.
- **Build**: Vite 7, adapter-node, `bundleStrategy:'single'`, SSR disabled.
- **Remote push**: Cloudflare Worker (`tools/aero-push-worker/`) for firmware-like OTA bundle + config delivery.

## Directory Structure

```
src/lib/
├── world/              WHAT we see — the map underneath (Cesium confined here)
│   ├── compose.ts      CesiumManager — imports cesium as type
│   ├── config.ts       Ion token, imagery URLs, VIEWER_OPTIONS (imports cesium as type)
│   ├── shaders.ts      GLSL color grading (emissive city lights)
│   ├── active.svelte.ts  Reactive holder — geo-effects consume here
│   └── CesiumViewer.svelte  dynamic import('cesium') happens here
│
├── camera/             HOW we look
│   ├── flight.svelte.ts  FlightSimEngine — orbit + cruise FSM + scenarios
│   └── motion.svelte.ts  Motion module — turbulence + bank + breathing + vibe
│
├── director/           WHEN things change
│   ├── autopilot.svelte.ts  Director module — weather randomiser + location cycler
│   └── scenarios.ts         Flight path waypoint data + weighted picker
│
├── show/               WHAT plays — authored experience primitive
│   └── load.ts              Show interface + applyShowOpening (boot baseline)
│
├── shell/              UI surround (airplane window pane, HUD, SidePanel, Blind, Glass, Weather)
│   ├── Pane.svelte         Layer compositor + RAF tick + window-frame toggle
│   ├── HUD.svelte          Telemetry overlay
│   ├── SidePanel.svelte    Composes panel/* sections — binds directly to config.*
│   ├── TelemetryPanel.svelte  Ring-buffer viewer (Shift+T)
│   ├── Toggle.svelte / RangeSlider.svelte / AirlineLoader.svelte
│   ├── use-blind.svelte.ts Composable — blind drag/snap controller
│   ├── window/             Blind / Glass / Weather (CSS backdrop filters on the pane)
│   ├── hud/                BlindInfoCard (closed-state) + TelemetryOverlay (open-state)
│   └── panel/              6 small control sections (LocationPicker, TimeControl, …)
│
├── model/              STATE graph + admin-tunable config tree
│   ├── crdt-store.ts            CRDT LWW-register store
│   ├── config-tree.svelte.ts    Flat $state config — SSOT for every tuning number
│   ├── frame-telemetry.svelte.ts  Ring-buffer: FPS p50/p95, events, counters
│   ├── aero-window.svelte.ts    createAeroWindow() / useAeroWindow() — root
│   └── aero-window-persistence.ts  localStorage save/load
│
├── scene/              Scene composition system
│   ├── types.ts             Effect<TParams> contract + LayerKind
│   ├── compositor.svelte    Mounts every Effect in z-order
│   ├── layers.ts            Z-order SSOT (effect registry + Weather + Window all import this)
│   ├── registry.ts          Static effect list (clouds, haze, lightning, micro-events, car-lights)
│   ├── bundle/              Pushable content bundles (CRUD + 4-tier fetch)
│   └── effects/             ALL registered effects live here
│       ├── clouds/         ArtsyClouds (CSS3D sprites) + effectiveCloudDensity rule
│       ├── haze/            Atmospheric haze gradient
│       ├── lightning/       Lightning flashes
│       ├── micro-events/    Stars / birds / contrails
│       ├── car-lights/      Cesium point entities — geo-positioned
│       ├── video-bg/        Full-scene video from a bundle (factory)
│       └── sprite/          Cesium billboard at lat/lon (factory)
│
├── fleet/              Remote Pi fleet management (REST + SSE, no broker)
│   ├── protocol.ts                 v1 + v2 messages
│   ├── client.svelte.ts            DeviceClient — SSE in, REST POST out
│   ├── rest-admin.svelte.ts        RestAdminStore — admin dashboard
│   ├── peer-sync.svelte.ts         $effect → POST PATCH /api/config to every peer
│   ├── heartbeat.svelte.ts         Server-side heartbeat ring buffer
│   ├── parallax.svelte.ts          MAC-fingerprint role bindings
│   ├── sse-bus.server.ts           In-process pub/sub for /api/events
│   ├── device-registry.server.ts   Per-device live status
│   ├── lan-peers.server.ts         mDNS discovery (started ONLY in `bun run server.ts`; `bun run dev` skips it so `/api/devices` shows only self)
│   └── lan-bundle-cache.server.ts  4-tier offline-Pi bundle ladder
│
├── world-three/        HYBRID THREE.JS PHOTOREAL OVERLAY — LAB-ONLY (Phase 16-17)
│   │                   Transparent Three.js canvas mounted ABOVE Cesium, camera-
│   │                   mirrored each frame (Cesium-PULL model, never push). Mounted
│   │                   ONLY in /playground/three — the ship route (/) is Cesium-only.
│   ├── ThreeOverlay.svelte    <Canvas> host — alpha:true + logarithmicDepthBuffer,
│   │                          near=1 far=1e9. Wires every effect below + the IBL <Sky>.
│   ├── CameraMirror.svelte    Copies Cesium positionWC/directionWC/upWC/fovy → Three cam
│   ├── EffectStack.svelte     EffectComposer: HDR→GodRays→Bloom→ChromAb→ACES→Vignette→grain
│   ├── sky.ts                 computeSunDirection (memo, ⚠ alias contract) + environmentAmbient
│   ├── prng.ts                createSeededRng(daySeed()) — 3-Pi determinism SSOT (invariant #4)
│   ├── Wing.svelte            Visible SWA wing mesh, camera-anchored, per-Pi fuselageOffsetM
│   ├── Clouds / NightStars / Moon / Venus / SunGlow / LensFlare / Meteors /
│   │   AtmosphericVeil / SparkleField / Rain / RainSpatter / WingContrail / CityGlowDome
│   └── OsmRoads / OsmBuildingEdges / NeonLineLayer   Neon line overlays (geo-anchored)
│
├── night/              Night rendering pipeline barrel — VIIRS + bloom + palette
│   └── thresholds.ts   T constants — SSOT for DAWN_START/DAY_START/DAY_END/DUSK_END/DEEP_NIGHT
│                        All four sky-state consumers (getSkyState, nightFactor, dawnDuskFactor,
│                        isSunVisible) import T. Edit one constant to shift the dusk window.
├── http/               Shared HTTP helpers — cors.ts, body.ts (size-limited reads)
│
├── types.ts, utils.ts, game-loop.ts   Shared primitives at the root.

content/                AUTHORED ARTIFACTS — what plays vs. how it plays
├── locations/          catalog.ts + per-location scene defaults
├── weather/            recipes.ts (WEATHER_EFFECTS)
├── palettes/           sky.ts + car-lights.ts (per-skyState + per-class colour)
└── shows/              default.show.ts — typed Show definitions

src/routes/
├── +layout.ts          ssr=false (app-wide; descendants inherit)
├── +page.svelte        Main display (Pi kiosk)
├── admin/              Fleet admin panel + content drag-drop + fleet/health
├── playground/         Scene labs (no fleet): /playground lean Cesium · /playground/three
│                       hybrid Cesium+Three · /playground/night-lab · /playground/model
└── api/                content + assets + tiles + buildings + fleet endpoints + bundle peer-cache

tools/
├── tile-packager/      Pre-downloads tiles for offline Pi
└── aero-push-worker/   Cloudflare Worker — firmware-like OTA push

tests/lib/…             Mirrors src/ layout; imports via $lib/* — 341 tests, 29 files

docs/
├── ADR-001-offline-tile-architecture.md
├── ADR-002-zero-cost-caching-strategy.md
├── ADR-012-html-in-canvas-defer.md
├── standards.md        Rules 0-10 (content/control split, effect layout, named exports, …)
├── CODEMAPS/           Module-level navigation docs
└── reference/          Integration recipes (e.g. takram atmosphere)
```

## Architectural Invariants (DO NOT BREAK)

These are the rules the architecture was designed to preserve. If a future change seems to violate one, flag it.

### 1. Cesium isolation
**Cesium is confined to `src/lib/world/`.** A handful of files import `cesium` as a **type** (`compose.ts`, `cesium-setup.ts`, `cloud-billboard-layer.ts`, `lightning-stage.ts`), and only `world/CesiumViewer.svelte` does the actual runtime `import('cesium')`. Every other module (engines, scene effects, config, fleet, shell) is framework-free and unit-testable. Verify with `rg "from 'cesium'|import\('cesium'\)" src/lib/` — every hit must be under `world/`. The exact count grows as new geo-effects are added; the invariant is the **directory boundary**, not the number.

### 2. Flat DTO boundary
`model.applyPatch(patch)` and the v1 fleet protocol are flat DTOs that cross the wire and `localStorage`. Phase 6 added v2 path-targeted patches (`config_patch { path, value }`) additively — v1 never changes shape. Persistence and fleet back-compat depend on this. Don't nest v1.

### 3. `untrack()` in hot paths
Every tick body wraps its work in `untrack(() => ...)` so 60 Hz config reads don't build reactive dependencies across the graph: `flight.svelte.ts:88`, `motion.svelte.ts:43`, `autopilot.svelte.ts:31`. If you add a new tick, wrap it too. Verify with `rg "^\s*untrack" src/lib/{camera,director}/`.

### 4. Deterministic visual layer for 3-Pi panorama continuity
Any sky/cloud/star content that uses `Math.random()` in a build-once-and-never-regen path **breaks 3-Pi panorama** — left/center/right Pis each pick independent randoms, the seams stop matching. Use `createSeededRng(daySeed())` from `world-three/prng.ts` instead. Per-frame randomness (twinkle phase advances, drift gust noise) is fine to stay live since the seam is invisible across instantaneous oscillation. See `world-three/NightStars.svelte` for the canonical pattern.

### 5. Sun-direction memo aliasing contract
`computeSunDirection(camLon, timeOfDay)` in `world-three/sky.ts` memoises and returns a **shared mutated array** on cache miss — collapses 6-8 component calls/frame into 1 trig eval. Safe when callers immediately read `d[0]/d[1]/d[2]` synchronously. UNSAFE if a caller stores the reference and reads later (by then another call may have rewritten the same array). Read-and-derive in the same synchronous block. Test-pinned in `tests/lib/world-three/sky.test.ts`.

### 6. Ship-vs-lab boundary + Cesium-pull camera
The `world-three/` Three.js overlay renders ONLY on `/playground/three`; the ship route `/` is Cesium-only. The overlay's camera is **pulled** from Cesium every frame in `CameraMirror.svelte` (copies `positionWC`/`directionWC`/`upWC`/`fovy`) — Three never drives the camera, Cesium does. Consequence: `compose.ts`, `flight.svelte.ts`, `motion.svelte.ts`, and `config-tree.svelte.ts` are SHARED between lab and ship — a change there ships to the Pi even though you were "only tuning the lab." Pure `world-three/*.svelte` changes are lab-only and safe. The CameraMirror also applies a Y↔Z handedness flip (so `+X` renders screen-LEFT), which is why on-screen signs in `Wing.svelte` are calibrated, not derived.

## AeroWindow — composition

```typescript
const model = createAeroWindow();         // in +page.svelte only
const model = useAeroWindow();            // in any descendant component

// Engines (tick at 60 Hz)
model.flight                            // FlightSimEngine instance (class)
model.motion                            // motion module — module-level $state, not a class

// Config tree (admin-tunable; drives engines via SimulationContext)
model.config.world.*                    // imagery + bloom + terrain + buildings + lights + qualityMode
model.config.atmosphere.clouds.*        // density, speed, layerCount
model.config.atmosphere.haze.*          // amount, min, max
model.config.atmosphere.weather.*       // frost altitudes, lightning timing
model.config.atmosphere.microEvents.*   // intervals + durations
model.config.camera.orbit.*             // driftRate, major/minor axes, breathe period
model.config.camera.cruise.*            // departureDurationSec, transitDurationSec, speeds
model.config.camera.motion.*            // bank, breathing, engine vibe, bump curve, turb mults
model.config.camera.altitude.*          // min / max / default
model.config.camera.parallax.*          // role, headingOffsetDeg, fovDeg, panoramaArcDeg, fuselageOffsetM
model.config.director.daylight.*        // syncToRealTime, manualTimeOfDay, syncIntervalMs
model.config.director.autopilot.*       // intervals, weather pool, director cycle
model.config.director.ambient.*         // drift magnitudes per randomisation cycle
model.config.shell.windowFrame         // master on/off for oval mask + rivets + glass (default: true — Phase 14 SWA demo)
model.config.shell.blindOpen           // live blind drag position (up=open)
model.config.shell.hudVisible
model.config.shell.sidePanelOpen
model.config.shell.showWing
model.config.shell.touchEnabled        // false default — gate for long-press accel + extras; basic blind drag is always on regardless (Council Q3, Phase 15)

// Observability
model.telemetry                         // Phase 5.6 — recordFrame / recordEvent / toJSON

// Derived
model.currentLocation                   // LOCATION_MAP.get(location)
model.skyState                          // day | dawn | dusk | night
model.nightFactor                       // 0-1
model.sceneFog                          // per-location fog settings
model.terrainExaggeration               // per-location (Himalayas 1.5x, cities 1.0x)
model.measuredFps                       // live FPS (Fleet + Telemetry)

// Patch dispatch (fleet v2 config_patch entry point)
model.applyConfigPatch(path, value)     // → _applyConfigPatch(path, value) in config-tree, also records telemetry

// Multi-Pi parallax leader hook (Phase 7)
model.setFleetBroadcast(fn)             // fleet client registers on connect
```

## Tick pipeline

```
Pane.svelte (RAF loop via game-loop.ts)
└── model.tick(delta)
    ├── frameStart = performance.now()
    ├── ctx = this.#createContext()        // carries config.camera, config.director, isLeader
    ├── flight.tick(delta, ctx)            → FlightPatch  (wraps body in untrack())
    ├── motionStep(delta, ctx)             → void         (wraps body in untrack())
    ├── directorTick(delta, ctx)           → WorldPatch   (early-returns if !ctx.isLeader)
    │   ├── #tickRandomize → AtmospherePatch
    │   └── #tickDirector  → LocationId
    ├── if (leader + broadcast hook)       emit director_decision (transitionAtMs = now+2.5s)
    ├── if autoQuality                     #tickAutoQuality
    └── telemetry.recordFrame(duration)

Scene effects subscribe to game-loop independently (lightning timer,
micro-event scheduler) — NOT driven by model.tick().
```

## Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(~2s)──→ cruise_transit ──(~2s)──→ orbit
                   (warp ramp, blind closes)    (teleport, blind opens)

Durations read from config.camera.cruise — admin-tunable.
```

## Multi-Pi parallax (Phase 7)

Three Pis side-by-side form one continuous panoramic window. Same shared state (location / altitude / weather / time / flightMode); per-device camera yaw.

### Role assignment (priority order)
1. `?role=left|center|right|solo` URL parameter
2. `localStorage['aero.device.role']` persisted from a prior URL param
3. Default `'solo'` (zero offset — identical to single-Pi mode)

### Behavior by role
| Role | Offset | Frame | Autopilot | Receives director_decision |
|---|---|---|---|---|
| `solo` | 0° | on | ✓ | — |
| `center` | 0° | off | ✓ (leader) | — |
| `left` | −(arc/2−arc/6)° | off | — (follower) | ✓, schedules @ `transitionAtMs` |
| `right` | +(arc/2−arc/6)° | off | — (follower) | ✓, schedules @ `transitionAtMs` |

When the leader picks a new location, it emits `{v:2, type:'director_decision', locationId, transitionAtMs: now+2500}` over the fleet; followers set a timeout to apply at the wall-clock instant. The 2.5s future window absorbs ~±200 ms NTP drift.

## Fleet protocol

**v1** (flat patches) and **v2** (path-targeted) coexist. Devices advertise both; servers can send either. See `src/lib/fleet/protocol.ts`.

v2 messages:
- `{v:2, type:'config_patch', path, value}` → `model.applyConfigPatch(path, value)`
- `{v:2, type:'config_replace', layer, snapshot}` → per-leaf `applyConfigPatch`
- `{v:2, type:'role_assign', deviceId, role, headingOffsetDeg?, fovDeg?, groupId?}`
- `{v:2, type:'director_decision', scenarioId, locationId, weather?, decidedAtMs, transitionAtMs, groupId?}`

## Tile caching strategy (ADR-002)

Zero-cost product vision. Every external tile source is **cached locally at build time** with remote origin as fallback. See `docs/ADR-002-zero-cost-caching-strategy.md`.

Cached sources (via `tools/tile-packager/`):
- `eox-sentinel2` — daytime imagery (z3-12)
- ~~`cartodb-dark`~~ — **dropped Phase 15.5**. Shader's `mix()` to navy now carries the atmospheric darkening.
- `cesium-terrain` — Ion quantized-mesh (requires `CESIUM_ION_TOKEN` at build only)
- `terrarium` — AWS PNG heightmap fallback
- `viirs-night-lights` — packaged but not currently wired into the app
- OSM buildings — per-location Overpass → GeoJSON, served at `/api/buildings/:city`

Total on-device budget: ~1.2 GB per Pi. Fielded device ships without Ion token.

## Remote push (Phase 5.7)

`tools/aero-push-worker/` — Cloudflare Worker with endpoints:
- `GET /bundles/:deviceId` → filtered list for this device
- `GET /configs/:deviceId` → pending config patches for this device
- `POST /bundles`, `POST /configs/:deviceId`, `DELETE /bundles/:id` (bearer auth)

Device-side: `src/lib/scene/bundle/remote.ts` polls via `startRemotePoll()`. Opt-in via `VITE_PUSH_WORKER_URL` env. Silent-fails if unreachable.

## Observability (Phase 5.6)

`model.telemetry` (`src/lib/model/frame-telemetry.svelte.ts`) — ring buffer with:
- FPS samples (last 120), rolling p50/p95 via percentile math
- Event log (last 500): `config_patch`, `fleet_in`, `fleet_out`, `error`, `info`
- Counters: configPatches, fleetIn, fleetOut, errors
- Perf: ~3 ns/`recordFrame` call, `$state.raw` + batched flushes
- Viewer: `TelemetryPanel.svelte`, toggled with **Shift+T**

## CSS z-layer order

Single source of truth: `src/lib/scene/layers.ts`. Effect registry, Weather.svelte, and Pane.svelte all import `Z` from there.

```
z:0   Cesium globe (terrain, buildings, night-light overlay, geo effects)
z:0   Atmospheric haze       (scene/effects/haze)
z:1   Clouds                  (scene/effects/clouds — CSS3D sprites)
z:2   Rain + Lightning        (shell/window/Weather + scene/effects/lightning)
z:3   Micro-events            (scene/effects/micro-events)
z:5   Frost                   (shell/window/Weather)
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

Scene effects own their declared z. Geo effects (`kind: 'geo'`) render inside Cesium so their compositor z is inert.

## Key patterns

### Type SSOT (types.ts)

Const-array-derived unions for both compile-time + runtime validation:
```typescript
export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = typeof WEATHER_TYPES[number];
```

### Context-based state access

```typescript
const model = createAeroWindow();  // only in +page.svelte
const model = useAeroWindow();     // in any descendant
```

### `$state` flat config via `config-tree.svelte.ts`

```typescript
// src/lib/model/config-tree.svelte.ts — one $state per namespace, literals
// inline at the default. No constants.ts. The config tree IS the SSOT.
export const atmosphere = $state({ clouds: { density: 0.85, speed: 0.6, layerCount: 3 }, ... });
export const camera = $state({ orbit: { driftRate: 0.01, major: 0.15, ... }, parallax: { role: 'solo', ... }, ... });

// Consumer binds directly
<RangeSlider bind:value={config.atmosphere.clouds.density} />
```

### CRITICAL: Variable naming

**Never name a variable `state` when using `$state`.** Use `model`, `engine`, `config`.

### User override pattern

`onUserInteraction(type)` pauses auto-behavior for 8 seconds via `UserOverrideTracker` — each flag (altitude/time/atmosphere) has its own independent timeout.

## Scene composition system

Each effect is a self-contained Svelte component that:
- Owns its own `$state` — no global mutation of AeroWindow
- Receives `{ model, params? }` as its only prop
- Subscribes to the game-loop directly via `$effect(() => subscribe(...))` if it needs ticking
- Mounts/unmounts via a `when` predicate evaluated against `model.*`

Compositor iterates `[...EFFECTS (static), ...bundleStore.effects (dynamic)]`.

Adding a new effect: create a folder under `scene/effects/<name>/` with `index.ts` exporting a named `Effect`, plus one line in `scene/registry.ts`. Z-index goes in `scene/layers.ts`.

### Geo-positioned effects (Cesium-native)

```typescript
import { activeCesium } from '$lib/world/active.svelte';

$effect(() => {
  const mgr = activeCesium.manager;
  if (!mgr) return;
  const Cesium = mgr.getCesium();
  const viewer = mgr.getViewer();
  const ds = new Cesium.CustomDataSource('my-effect');
  viewer.dataSources.add(ds);
  return () => viewer.dataSources.remove(ds, true);
});
```

## Routes

- `/` — Main window display (Pi kiosk). Full shell.
- `/playground` — Lean Cesium scene lab. Same `CesiumViewer` + `Compositor` + `Weather` as `/`, no shell / fleet. For tuning the composite in isolation.
- `/playground/three` — Hybrid Cesium + Three.js composition lab. `CesiumViewer` (terrain/imagery/VIIRS/atmosphere/post-process) + `ThreeOverlay` (clouds/wing/sky-extras/neon/postprocess) inside `WindowChrome`. The R&D surface for everything in `world-three/`. **Lab-only** — none of the Three overlay ships on `/`.
- `/playground/night-lab` + `/playground/model` — focused night-look and model-inspection labs.
- `/admin` — Fleet admin panel.
- `/admin/content` — Drag-drop bundle UI (LAN-only).
- `/admin/fleet/health` — Fleet health dashboard.
- `/api/content` + `/api/content/[id]` — Content bundle CRUD + delete.
- `/api/assets` + `/api/assets/[filename]` — Asset upload + serve.
- `/api/bundle/[hash]` — LAN peer-cache bundle blob.
- `/api/buildings/:city` — OSM extrusion GeoJSON.
- `/api/tiles/[...path]` — Tile proxy.
- `/api/fleet/heartbeat` + `/api/devices` + `/api/status` + `/api/config` + `/api/command` + `/api/events` — REST + SSE fleet surface (no central broker). `/api/config` PATCH validates the path against a namespace allowlist (`atmosphere|camera|director|world|shell`) before publishing, blocking `__proto__` / `constructor.prototype` style writes at the wire. **Bearer-gated since Phase 15 (Day 1, commit `77f244f`)** — `requireAdminToken(request)` runs first; the kiosk browser fetches its own token via the localhost-only `/api/internal/peer-token` route.
- `/api/content` POST + `/api/content/[id]` DELETE + `/api/assets` POST — admin-only mutating routes. Require `Authorization: Bearer $AERO_ADMIN_TOKEN`; return 503 if the env var is unset (fail closed). GET routes remain unauthenticated. Admin UI at `/admin/content` prompts for the token and caches in `sessionStorage`.
- `/api/internal/peer-token` GET — localhost-only (rejects requests where `getClientAddress()` is not `127.0.0.1` or `::1`). Returns `{ token: process.env.AERO_ADMIN_TOKEN }` so the kiosk Pi's browser can include a bearer header on peer-sync's PATCH `/api/config` calls without baking the secret into the JS bundle. 403 cross-origin / 503 if env unset (fail closed). Browser-side helper at `src/lib/http/peer-token.ts` caches in module memory.
- `/api/wifi/reset` — Pi-only: purge saved WiFi + reboot to captive-portal mode. Gated by `Authorization: Bearer $AERO_WIFI_RESET_TOKEN`; returns 503 if the env var is unset (fail closed).

## Environment variables

```
VITE_CESIUM_ION_TOKEN=...     Required for terrain/imagery (Cesium Ion) at dev time
                              Build-time only for production — stays on build machine
VITE_MAPBOX_TOKEN=...         Optional — enables Mapbox Satellite (50k/mo free)
VITE_TILE_SERVER_URL=...      Optional — self-hosted tile cache (Pi deployment)
VITE_PUSH_WORKER_URL=...      Optional — Cloudflare Worker for OTA push (Phase 5.7)
AERO_BUNDLES_DIR=...          Server-side, default ./data/bundles
AERO_ASSETS_DIR=...           Server-side, default ./data/assets
TILE_DIR=...                  Server-side, default /opt/zyeta-aero/tiles
CESIUM_ION_TOKEN=...          Build-time only, for tile-packager Ion terrain download
ADMIN_TOKEN=...               CF Worker bearer auth for POST /bundles + POST /configs
AERO_ADMIN_TOKEN=...           Pi-side bearer auth for POST /api/content, DELETE
                              /api/content/[id], POST /api/assets. Routes return 503
                              when unset (fail closed). Set on Pi; the admin UI at
                              /admin/content prompts for it on first use.
AERO_WIFI_RESET_TOKEN=...     Pi-side bearer auth for POST /api/wifi/reset. Endpoint
                              returns 503 when unset (fail closed). Set on Pi only.
```

## Build configuration

- **Cesium assets** copied via `vite-plugin-static-copy` to `/cesiumStatic`
- **Bundle**: `bundleStrategy: 'single'` for Pi deployment (`inlineDynamicImports`)
- **Adapter**: `adapter-node` (Bun serves the build)
- **CSP**: Cesium Ion, Mapbox, ESRI, EOX, CartoDB, and fleet WS on any LAN host
- **SSR**: disabled (`export const ssr = false`)
- **TypeScript**: strict mode

## Pi 5 deployment

- Hostname: `aero-display-00.local`
- Services: `aero-xserver`, `aero-app` (:5173), `aero-kiosk` (Chromium)
- Auto-starts on boot via systemd
- Chromium: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- CMA: 512 MB, GPU turbo ready (needs fan)
- Chromium disk cache: 2 GB at `/home/pi/.cache/aero-tiles` — warm fallback

## Phase history

| Phase | What | Commit |
|---|---|---|
| 0 surgical | Globe lighting + shadows + reduce-motion scope | `ab61f08` |
| 0a spike | Svelte 5 `$state` + `bind:` pattern validation | folded into `76e13bd` |
| 0b night | Emissive shader per-pixel palette + bloom stage | `e4a9525` |
| 0c packager | Ion terrain + Terrarium + Overpass buildings | `3c603ae` |
| 1 config | 6 `$state` config classes under `model/config/` | `3d99df8` |
| 2 world | `cesium/` → `world/` with isolation preserved | `5198544` |
| 3 camera/director | `simulation/` split; `WorldEngine` → `DirectorEngine` | `ca8d3ec` |
| 3.5 consumers | Engines read tuning from `ctx.camera.*` / `ctx.director.*` | `02ffa41` |
| 4 atmosphere | Scene effects + UI overlays → `atmosphere/` | `f60a550` |
| 5 shell | `ui/` → `chrome/` → `shell/` + window on/off toggle | `dc00117` |
| 5.5 polish | Blind hint, route jitter, long-press boost, atmo drift | `333077d` |
| 6 fleet v2 | Additive protocol v2 — `config_patch`, `role_assign`, etc. | `1aba65e` |
| 5.7 push | Cloudflare Worker firmware-like OTA | `909ab7c` |
| 7 parallax | Multi-Pi yaw offset + leader/follower director | `fea557f` |
| 5.6 observe | Ring-buffer telemetry + in-window viewer | `5d1dd16` |
| 8 clouds css3d | ArtsyClouds (CSS3D sprites) promoted as canonical cloud renderer | `970c146` |
| 8a route cleanup | `/content` → `/admin/content`; `/lan/bundle` → `/api/bundle`; `/playground2` deleted | `6dc4abc` |
| 8b scene lab | `/playground` re-Cesiumified as lean composition lab (−1,612 lines) | `970c146` |
| 9 fleet REST+SSE | WebSocket broker → REST + per-device SSE. CRDT LWW with sourceId tiebreak. Peer-sync `$effect` propagates config writes. | (Apr 23 series) |
| 10 content split | `content/` folder for authored artifacts (locations, weather, palettes, shows) + `$content` alias. `Show` primitive (boot baseline). `docs/standards.md` codifies Rules 0-10. | (Apr 23 series) |
| 11 consolidation | atmosphere/ → scene/effects/; constants.ts deleted (literals inline at config-tree); auto-quality.ts deleted; ssr-off hoisted to layout; admin/architecture/ deleted; dead exports demoted. | (Apr 24-26 series) |
| 12 night look + Pane rename | `shell/Window.svelte` → `shell/Pane.svelte` (case-collision with `shell/window/` gone). VIIRS `dayAlpha=0`/`nightAlpha=1` so terminator shading no longer dims night-lit cities. baseNightSaturation 0.25 → 0.05 (kills blue cast at deep night). skyAtmosphere `saturationShift`/`brightnessShift` lerped HARDER negative as `dawnDuskFactor` peaks (fixes inverted-sign bug). Shader's horizon-haze + dawn-rim blocks deleted (duplicates of HazeEffect + skyAtmosphere). Clouds PNG → WebP (-61% bytes). `shell.windowFrame: false` default — full-bleed Cesium fills the viewport; blind still works in either mode. Softer car-light dots (1.4 px + sharper falloff + translucencyByDistance). | (Apr 27 series) |
| 13 SSOT sweep | Four duplicated literals → SSOT homes: fleet timings → `fleet/timings.ts`; peer URL → `fleet/peer-url.ts`; bundle ID pattern → `bundle/loader.ts`. Night time-of-day boundaries → `night/thresholds.ts` (`T` constants). All sky consumers (getSkyState, nightFactor, dawnDuskFactor, isSunVisible) share T. | 4d20c47 + c134ee9 |
| 14 demo mode (SWA inaug.) | Default location=hyderabad, windowFrame=true. Dusk palette: warm amber arc (no purple mid-tone). satShift dd contrib -0.5→-0.08 (preserves Cesium warm sunset scatter). Globe dusk correction dd*0.3→dd*0.15. Dusk skyState window 18→21h (blue hour). 250/250 tests. | eb7bde0–112fa8a |
| 15 Day-1 ship prep (SWA) | Council on Q2/Q3/Q5/Q6 with game/experience lenses. defaultShow → dawn over Hyderabad (clear/06:30). `/api/config` PATCH bearer-gated (Option B: localhost-only `/api/internal/peer-token` route + browser cache + peer-sync bearer header injection). `shell.touchEnabled` gate (passenger mode default; long-press accel + extras behind operator toggle). SSE ring-buffer replay (config_patch + command events survive browser reload). `/architecture` page authored (7+2 pillars: Time + Networking promoted from "hidden inside State" to first-class). 274/274 tests, `pre-ship-v1` tag. | 013e151–eadcf9c |
| 15.5 night pipeline simplification | 4-lens council (game-design/game-dev/exp-design/exp-dev) voted P2 (3-of-1). Phases LANDED: (1) shader-driven base darkening replaces CartoDB layer's atmospheric ramp via `mix(rgb, navy, smoothstep(0.45,0.9,nf)*0.85*(1-brightGuard))`; (2) drop CartoDB Dark imagery layer entirely; (1.5a) drop redundant base-imagery brightness lerp; (1.5b) drop shader shadow-crush + contrast (~90% redundant with HDR tonemap + bloom); (1.5c) collapse 3 glass DOM layers (z:9+10+11) into one element with stacked gradients + inset box-shadow + `@property`-registered CSS var for rim transitions; (7) drop orphan night config fields (`nightAlpha`, `nightBrightness`, `nightContrast`, `baseNightBrightness`). Result: 3 imagery layers → 2, 5 shader ops → 3, 11 DOM compositor layers → 9, 7 admin night sliders → 4. Council Phases 3-6 (productionize variant E altitude-aware buildings emissive + variant F vector OSM roads + altitude-gate VIIRS) queued for post-hardware-validation. See `docs/ADR-003-night-pipeline-simplification.md`. | 51f4290–a8b3fe5 |
| 16 hybrid Three.js photoreal overlay | New `world-three/` domain (21 files, ~3,000 LOC) — transparent Three.js canvas above Cesium, camera-mirrored each frame. Components: `Clouds` (sprite cluster system with Mie forward-scatter + sun-side shading + smoothstep yNorm gradient + per-cluster wind shear), `Moon` (sphere mesh + custom ShaderMaterial doing Lambert + procedural value-noise cratering + limb darkening + libration drift), `SunGlow` (core + halo sprites + atmospheric shimmer at low sun), `LensFlare` (2 ghosts max + jitter), `NightStars` (1,200 stars with 4 Bayer spectral classes + power-law magnitude + per-star twinkle, **deterministic-seeded for 3-Pi panorama continuity**), `Meteors` (rare streak events 60-240s intervals at deep night), `AtmosphericVeil` (slow breathing), `SparkleField` (camera-tracked cabin-air dust), `Rain` (300 particles with per-particle size/speed/sway + burst-pause lifecycle), `RainSpatter` (procedural droplet shader on camera near-plane quad), `OsmRoads` + `OsmBuildingEdges` (neon line overlays). Postprocessing chain in `EffectStack.svelte`: HalfFloat HDR → GodRays → Bloom VERY_LARGE → ChromAb → ToneMap ACES → Vignette → Noise grain. Cesium-side: skyBox disabled (Milky Way arc removed), fog nightBrightness=0 across all archetypes (white horizon band killed), atmosphereLight 4.5→2.4. `SUN_PLACEMENT_M` consolidated in `sky.ts`. `computeSunDirection` memoised with ⚠ aliasing contract documented + test-pinned. Sky cubemap throttled to >0.5° sun movement. Cluster rebuild debounced 200ms. **`prng.ts` provides deterministic seeded RNG via mulberry32 + daySeed() — 3-Pi panorama continuity** (all 3 Pis on same day → same stars + cloud positions → no seam). 311/311 tests, 24 test files. | (May 28-30 session) |
| 17 wing infrastructure + 3-Pi determinism completion | (1) `Wing.svelte` — visible 3D right wing in `world-three/`. Custom 8-vertex tapered BufferGeometry (root 8m chord × 1.2m thickness, tip 1.5m chord × 0.3m thickness, span 17m). Camera-anchored per WingContrail pattern; lit by scene AmbientLight (no per-component sun light — picks up env mood automatically). Bank rotation post-multiplied as local-z quaternion (matches old CSS `rotate()` axis). Right-wingtip nav lights gated by `nightFactor`: continuous green emerald + 60ms white anti-collision strobe pulsing every 1s. (2) `parallax.fuselageOffsetM` — new config field, applied to wing X (fore-aft fuselage axis): `left = -6m` (front passenger seat, sees trailing edge), `center = 0`, `right = +6m` (aft seat, sees leading edge). `fuselageOffsetForRole()` SSOT helper added next to `headingOffsetForRole()`. `setParallaxRole()` now drives both. (3) **3-Pi determinism BLOCKER fixed**: `Clouds.svelte` had 15+ `Math.random()` calls in build-once cluster generation (violation of invariant #4) — seeded with `createSeededRng(daySeed())` per the canonical `NightStars` pattern. Same fix applied to `Rain.svelte` droplet positions. Without this the 3-Pi cloud panorama seam failed silently. (4) Camera near `100 → 1.0` in `ThreeOverlay` so camera-anchored cabin-space geometry (Wing, future cabin details) renders without near-plane clipping. logarithmicDepthBuffer handles precision at distant Cesium tiles. (5) Legacy CSS `.wing-silhouette` deleted from `Pane.svelte` + playground duplicate + `Z.wing` enum. (6) Playground `?role=...` simulator bug fixed — direct mutation of `p.role` bypassed `setParallaxRole()` so `fuselageOffsetM` never updated; now routes through SSOT setter. 329/329 tests (5 new for `fuselageOffsetForRole`). | (Jun 8 session) |
