# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view using Cesium for terrain + CSS effect layers, syncing with real time of day. Designed for Raspberry Pi 5 fleet deployment with headless Chromium kiosk mode. Supports multi-Pi panorama rigs (three devices side-by-side forming one continuous window) via the Phase 7 parallax system.

## Commands

```bash
bun run dev          # Start development server (Vite, binds 0.0.0.0 for LAN)
bun run build        # Build for production (single-bundle for Pi)
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run check:watch  # Type check in watch mode
bun x vitest run     # Run unit/integration tests (104 tests currently)
```

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable()`, `createContext` on 5.40+)
- **Terrain**: Cesium.js — the *only* framework isolated to one file (`src/lib/world/compose.ts`). Every other module is Cesium-free and independently testable.
- **Imagery**: EOX Sentinel-2 Cloudless (default, no auth) → Mapbox Satellite (token-gated) → ESRI World Imagery (fallback).
- **Atmosphere**: SVG feTurbulence clouds, CSS rain/frost/lightning, procedural micro-events.
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks.
- **State**: Class-based `$state` with `setContext`/`getContext` DI. Five admin-tunable `Config` classes live under `model/config/`. Fleet v2 protocol routes path-targeted patches through `model.config.applyPatch(path, value)`.
- **Build**: Vite 7, adapter-node, `bundleStrategy:'single'`, SSR disabled.
- **Remote push**: Cloudflare Worker (`tools/aero-push-worker/`) for firmware-like OTA bundle + config delivery.

## Directory Structure

```
src/lib/
├── world/              WHAT we see — the map underneath
│   ├── compose.ts      CesiumManager — THE ONE file that imports cesium
│   ├── config.ts       Ion token, imagery URLs, VIEWER_OPTIONS
│   ├── shaders.ts      GLSL color grading (emissive city lights)
│   ├── active.svelte.ts  Reactive holder — geo-effects consume here
│   └── CesiumViewer.svelte  dynamic import('cesium') happens here
│
├── atmosphere/         BETWEEN the camera and the world
│   ├── clouds/         CloudBlobs (SVG turbulence 3-layer parallax) + effect wrapper
│   ├── weather/        Weather.svelte (rain+frost) + Lightning.svelte + lightning.ts registry
│   ├── micro-events/   MicroEvent (stars/birds/contrails) + effect wrapper
│   └── haze/           Atmospheric haze gradient — softens LOD seams
│
├── camera/             HOW we look
│   ├── flight.svelte.ts  FlightSimEngine — orbit + cruise FSM + scenarios
│   └── motion.svelte.ts  MotionEngine — turbulence + bank + breathing + vibe
│
├── director/           WHEN things change
│   ├── autopilot.svelte.ts  DirectorEngine — weather randomiser + location cycler
│   └── scenarios.ts         Flight path waypoint data + weighted picker
│
├── chrome/             UI shell
│   ├── Window.svelte       Layer compositor + RAF tick + long-press boost + window-frame toggle
│   ├── HUD.svelte          Telemetry overlay (location, altitude, speed, time, cruise badge)
│   ├── SidePanel.svelte    Location picker + all settings (binds directly to config.*)
│   ├── TelemetryPanel.svelte  Phase 5.6 ring-buffer viewer (Shift+T)
│   ├── Toggle.svelte       Bindable ($bindable) toggle pill
│   ├── RangeSlider.svelte  Range slider
│   ├── AirlineLoader.svelte  Preloader animation
│   └── use-blind.svelte.ts  Composable — blind drag/snap controller
│
├── model/              STATE graph + admin-tunable config tree
│   ├── state.ts             (reserved — WindowModel still lives at lib root for now)
│   ├── telemetry.svelte.ts  Phase 5.6 ring-buffer: FPS p50/p95, events, counters
│   └── config/                    Phase 1 — $state classes, admin-tunable
│       ├── world.svelte.ts        14 fields (imagery dim, bloom, terrain, buildings, lights)
│       ├── atmosphere.svelte.ts   4 sub-configs (clouds, haze, weather, microEvents)
│       ├── camera.svelte.ts       5 sub-configs — inc. parallax (role, headingOffsetDeg, fovDeg)
│       ├── director.svelte.ts     3 sub-configs (daylight, autopilot, ambient drift)
│       ├── chrome.svelte.ts       windowFrame, blindOpen, hudVisible, sidePanelOpen, showWing
│       └── index.ts               RootConfig aggregator + applyPatch(path, value) dispatcher
│
├── scene/              Scene composition system
│   ├── types.ts             Effect<TParams> contract + LayerKind
│   ├── compositor.svelte    Mounts every Effect in z-order
│   ├── registry.ts          Static effect list (cloud / weather / micro / car-lights / haze)
│   ├── bundle/              Pushable content bundles
│   │   ├── types.ts         VideoBgBundle | SpriteBundle + WhenPredicate
│   │   ├── when.ts          Pure evalWhen — predicate → boolean
│   │   ├── loader.ts        createEffectFromBundle + isContentBundle
│   │   ├── store.svelte.ts  Reactive bundleStore (install/remove)
│   │   ├── client.ts        hydrateFromServer / LAN bundle push
│   │   ├── remote.ts        Phase 5.7 Cloudflare poll client
│   │   ├── disk.server.ts   Filesystem persistence (node:fs)
│   │   └── assets.server.ts Content-addressed asset storage
│   └── effects/
│       ├── car-lights/      Cesium point entities — jugaad procedural
│       ├── video-bg/        Full-scene video from a bundle
│       └── sprite/          Cesium billboard at lat/lon
│
├── fleet/              Remote Pi fleet management (bounded context)
│   ├── protocol.ts          v1 messages + Phase 6 v2 additive (config_patch, role_assign, director_decision)
│   ├── transport.svelte.ts  BaseTransport — WS/SSE with $state + auto-reconnect
│   ├── client.svelte.ts     Display → fleet connection; publishV2() for leader broadcast
│   ├── admin.svelte.ts      Admin dashboard store
│   ├── hub.ts               Server-side WS hub + SSE broadcast
│   └── url.ts               Fleet endpoint resolver
│
├── app-state.svelte.ts  WindowModel root — composes engines + config + telemetry; owns tick
├── types.ts, utils.ts, locations.ts, validation.ts, persistence.ts, constants.ts, game-loop.ts

src/routes/
├── +page.svelte         Main display (Pi kiosk) — role init, CF push wire-up
├── admin/               Fleet admin panel + ConfigSandbox
├── architecture/        Architecture visualization
├── content/             Drag-drop bundle UI (LAN only)
├── playground/          MapLibre + Cesium experiment sandbox
└── api/                 Content + assets + tiles + buildings + fleet endpoints

tools/
├── tile-packager/       Pre-downloads tiles for offline Pi (Sentinel, CartoDB, Terrarium, Ion terrain, OSM buildings)
└── aero-push-worker/    Phase 5.7 Cloudflare Worker — firmware-like OTA push

tests/lib/…              All tests — mirrors src/ layout; imports via $lib/*

docs/
├── ADR-001-offline-tile-architecture.md
├── ADR-002-zero-cost-caching-strategy.md
├── CODEMAPS/            Module-level navigation docs
├── analysis/, plans/, reference/
```

## Architectural Invariants (DO NOT BREAK)

These are the three rules the whole reorg was designed to preserve. If a future change seems to violate one, flag it.

### 1. Cesium isolation
**Only `src/lib/world/compose.ts` may import `cesium`** (as a type) and **only `src/lib/world/CesiumViewer.svelte`** does the actual `import('cesium')` at runtime. Every other module (engines, scene effects, config classes, fleet) is framework-free and unit-testable. Verify with `rg "from 'cesium'" src/lib/`.

### 2. Flat DTO boundary
`model.applyPatch(patch)` and the v1 fleet protocol are flat DTOs that cross the wire and `localStorage`. Phase 6 added v2 path-targeted patches (`config_patch { path, value }`) additively — v1 never changes shape. Persistence and fleet back-compat depend on this. Don't nest v1.

### 3. `untrack()` in hot paths
Every `tick()` body (FlightSimEngine, MotionEngine, DirectorEngine) wraps its work in `untrack(() => ...)` so 60 Hz config reads don't build reactive dependencies across the graph. If you add a new engine, wrap its tick too.

## WindowModel — composition

```typescript
const model = createAppState();         // in +page.svelte only
const model = useAppState();            // in any descendant component

// Engines (tick at 60 Hz)
model.flight                            // FlightSimEngine
model.motion                            // MotionEngine
model.director                          // DirectorEngine  (renamed from WorldEngine in Phase 3)

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
model.config.camera.parallax.*          // role, headingOffsetDeg, fovDeg, panoramaArcDeg
model.config.director.daylight.*        // syncToRealTime, manualTimeOfDay, syncIntervalMs
model.config.director.autopilot.*       // intervals, weather pool, director cycle
model.config.director.ambient.*         // drift magnitudes per randomisation cycle
model.config.chrome.windowFrame         // master on/off for oval mask + rivets + glass
model.config.chrome.blindOpen           // live blind drag position (up=open)
model.config.chrome.hudVisible
model.config.chrome.sidePanelOpen
model.config.chrome.showWing

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
model.applyConfigPatch(path, value)     // → config.applyPatch(path, value), also records telemetry

// Multi-Pi parallax leader hook (Phase 7)
model.setFleetBroadcast(fn)             // WS client registers on connect
```

## Tick pipeline

```
Window.svelte (RAF loop via game-loop.ts)
└── model.tick(delta)
    ├── frameStart = performance.now()
    ├── ctx = this.#createContext()        // carries config.camera, config.director, isLeader
    ├── flight.tick(delta, ctx)            → FlightPatch  (wraps body in untrack())
    ├── motion.tick(delta, ctx)            → void         (wraps body in untrack())
    ├── director.tick(delta, ctx)          → WorldPatch   (early-returns if !ctx.isLeader)
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
- `cartodb-dark` — night overlay (z3-14, `dark_nolabels` variant)
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

`model.telemetry` (`src/lib/model/telemetry.svelte.ts`) — ring buffer with:
- FPS samples (last 120), rolling p50/p95 via percentile math
- Event log (last 500): `config_patch`, `fleet_in`, `fleet_out`, `error`, `info`
- Counters: configPatches, fleetIn, fleetOut, errors
- Perf: ~3 ns/`recordFrame` call, `$state.raw` + batched flushes
- Viewer: `TelemetryPanel.svelte`, toggled with **Shift+T**

## CSS z-layer order

```
z:0   Cesium globe (terrain, buildings, night-light overlay, geo effects)
z:1   Clouds             (atmosphere/clouds — SVG feTurbulence)
z:2   Rain + Lightning   (atmosphere/weather)
z:3   Micro-events       (atmosphere/micro-events)
z:5   Frost              (atmosphere/weather)
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
const model = createAppState();  // only in +page.svelte
const model = useAppState();     // in any descendant
```

### `$state` classes with `$bindable()`

```typescript
// In any Config class
class ChromeConfig {
  windowFrame = $state(true);   // consumer: <Toggle bind:checked={config.chrome.windowFrame} />
}
```

### CRITICAL: Variable naming

**Never name a variable `state` when using `$state`.** Use `model`, `engine`, `config`.

### User override pattern

`onUserInteraction(type)` pauses auto-behavior for 8 seconds via `UserOverrideTracker` — each flag (altitude/time/atmosphere) has its own independent timeout.

## Scene composition system

Each effect is a self-contained Svelte component that:
- Owns its own `$state` — no global mutation of WindowModel
- Receives `{ model, params? }` as its only prop
- Subscribes to the game-loop directly via `$effect(() => subscribe(...))` if it needs ticking
- Mounts/unmounts via a `when` predicate evaluated against `model.*`

Compositor iterates `[...EFFECTS (static), ...bundleStore.effects (dynamic)]`.

Adding a new effect: create a folder under `atmosphere/<name>/` or `scene/effects/<name>/` with `index.ts` exporting a default `Effect`, plus one line in `scene/registry.ts`.

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

- `/` — Main window display (Pi kiosk)
- `/playground` — MapLibre + Cesium experiment sandbox
- `/content` — Drag-drop bundle UI (LAN)
- `/admin` — Fleet admin panel (incl. ConfigSandbox for live $state preview)
- `/architecture` — Architecture visualization
- `/api/content` — Content bundle CRUD
- `/api/assets` — Asset upload + serve
- `/api/buildings/:city` — OSM extrusion GeoJSON (Phase 0c)
- `/api/tiles/[...path]` — Tile proxy
- `/api/fleet` — Fleet server endpoint

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
| 5 chrome | `ui/` → `chrome/` + window on/off toggle | `dc00117` |
| 5.5 polish | Blind hint, route jitter, long-press boost, atmo drift | `333077d` |
| 6 fleet v2 | Additive protocol v2 — `config_patch`, `role_assign`, etc. | `1aba65e` |
| 5.7 push | Cloudflare Worker firmware-like OTA | `909ab7c` |
| 7 parallax | Multi-Pi yaw offset + leader/follower director | `fea557f` |
| 5.6 observe | Ring-buffer telemetry + in-window viewer | `5d1dd16` |
