# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view synced to time of day, designed for Raspberry Pi 5 fleet deployment with headless Chromium kiosk mode.

**Active branch:** `playground/maplibre-app` — v2 open-source rewrite using MapLibre GL + PMTiles + Takram three-geospatial. Cesium is **deprecated** (isolated to `src/lib/world/` for reference; all new work uses MapLibre). Deployment target: SWA Hyderabad (SATTVA Knowledge Park), end of May 2026.

## Commands

```bash
bun run dev          # Start development server (Vite, binds 0.0.0.0 for LAN)
bun run build        # Build for production (single-bundle for Pi)
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run check:watch  # Type check in watch mode
bun x vitest run     # Run unit/integration tests
```

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable()`, `createContext` on 5.40+)
- **Terrain**: MapLibre GL + PMTiles (open-source, v2 stack). Cesium is deprecated — isolated in `src/lib/world/`, do not extend.
- **3D/Atmosphere**: `@takram/three-atmosphere`, `@takram/three-clouds`, `@takram/three-geospatial` via Threlte.
- **Imagery**: PMTiles offline tiles (primary) → EOX Sentinel-2 Cloudless (fallback).
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
├── night/              Night rendering pipeline barrel — VIIRS + bloom + palette
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
├── playground/         Lean Cesium scene lab (same pipeline as /, no shell)
└── api/                content + assets + tiles + buildings + fleet endpoints + bundle peer-cache

tools/
├── tile-packager/      Pre-downloads tiles for offline Pi
└── aero-push-worker/   Cloudflare Worker — firmware-like OTA push

tests/lib/…             Mirrors src/ layout; imports via $lib/*

docs/
├── ADR-001-offline-tile-architecture.md
├── ADR-002-zero-cost-caching-strategy.md
├── ADR-012-html-in-canvas-defer.md
├── standards.md        Rules 0-10 (content/control split, effect layout, named exports, …)
├── CODEMAPS/           Module-level navigation docs
└── reference/          Integration recipes (e.g. takram atmosphere)
```

## Architectural Invariants (DO NOT BREAK)

These are the three rules the whole reorg was designed to preserve. If a future change seems to violate one, flag it.

### 1. Cesium isolation
**Cesium is confined to `src/lib/world/`.** Only `world/compose.ts` and `world/cesium-setup.ts` import `cesium` (as a type), and only `world/CesiumViewer.svelte` does the actual `import('cesium')` at runtime. Every other module (engines, scene effects, config, fleet, shell) is framework-free and unit-testable. Verify with `rg "from 'cesium'" src/lib/` — expect exactly 2 hits, both in `world/`.

### 2. Flat DTO boundary
`model.applyPatch(patch)` and the v1 fleet protocol are flat DTOs that cross the wire and `localStorage`. Phase 6 added v2 path-targeted patches (`config_patch { path, value }`) additively — v1 never changes shape. Persistence and fleet back-compat depend on this. Don't nest v1.

### 3. `untrack()` in hot paths
Every tick body wraps its work in `untrack(() => ...)` so 60 Hz config reads don't build reactive dependencies across the graph: `flight.svelte.ts:88`, `motion.svelte.ts:43`, `autopilot.svelte.ts:31`. If you add a new tick, wrap it too. Verify with `rg "^\s*untrack" src/lib/{camera,director}/`.

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
model.config.camera.parallax.*          // role, headingOffsetDeg, fovDeg, panoramaArcDeg
model.config.director.daylight.*        // syncToRealTime, manualTimeOfDay, syncIntervalMs
model.config.director.autopilot.*       // intervals, weather pool, director cycle
model.config.director.ambient.*         // drift magnitudes per randomisation cycle
model.config.shell.windowFrame         // master on/off for oval mask + rivets + glass (default: false — full-bleed Cesium)
model.config.shell.blindOpen           // live blind drag position (up=open)
model.config.shell.hudVisible
model.config.shell.sidePanelOpen
model.config.shell.showWing

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
- `/admin` — Fleet admin panel.
- `/admin/content` — Drag-drop bundle UI (LAN-only).
- `/admin/fleet/health` — Fleet health dashboard.
- `/api/content` + `/api/content/[id]` — Content bundle CRUD + delete.
- `/api/assets` + `/api/assets/[filename]` — Asset upload + serve.
- `/api/bundle/[hash]` — LAN peer-cache bundle blob.
- `/api/buildings/:city` — OSM extrusion GeoJSON.
- `/api/tiles/[...path]` — Tile proxy.
- `/api/fleet/heartbeat` + `/api/devices` + `/api/status` + `/api/config` + `/api/command` + `/api/events` — REST + SSE fleet surface (no central broker).
- `/api/wifi/reset` — Pi-only: purge saved WiFi + reboot to captive-portal mode. **No auth yet — LAN-only assumption; gate behind a shared secret before commercial release.**

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
