# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view using Cesium for terrain with CSS effect layers, syncing with real time of day. Designed for Raspberry Pi 5 fleet deployment with headless Chromium kiosk mode.

## Commands

```bash
bun run dev          # Start development server (Vite, binds 0.0.0.0 for LAN)
bun run build        # Build for production (single-bundle for Pi)
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run check:watch  # Type check in watch mode
```

Vitest is available for unit tests. No linter is configured. Type checking remains the primary validation tool.

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Terrain**: Cesium.js for real-world imagery, terrain, 3D buildings
- **Imagery**: Mapbox Satellite (primary) → ESRI World Imagery (fallback, no auth needed)
- **Clouds**: SVG feTurbulence + CSS animation (no WebGL shader)
- **Trees**: Procedural CSS-only layer (no images, no WebGL)
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks
- **State**: Context-based singleton (`setContext`/`getContext`) + composed engine classes
- **Build**: Vite 7, adapter-node, bundleStrategy:'single', SSR disabled

## Directory Structure

```
src/
├── lib/                 # Shared library — importable via $lib/* alias
├── routes/              # SvelteKit routes (+ route-colocated lib)
└── app.html

tests/                   # All unit/integration tests — mirrors src/ paths
└── lib/…                # e.g. tests/lib/utils.test.ts → src/lib/utils.ts

src/lib/
├── types.ts              # SSOT — all domain types, const-array-derived unions
├── constants.ts          # Tuning: AIRCRAFT, FLIGHT_FEEL, AMBIENT, WEATHER_EFFECTS, CESIUM
├── locations.ts          # 18 cities with lat/lon/scene defaults
├── utils.ts              # clamp, lerp, normalizeHeading, shortestAngleDelta, getSkyState, formatTime
├── validation.ts         # isValidWeather/DisplayMode/QualityMode + safeParse
├── persistence.ts        # localStorage save/load with validation
├── app-state.svelte.ts   # WindowModel orchestrator + context DI
├── game-loop.ts          # RAF singleton (subscriber pattern, per-callback error tracking)
│
├── simulation/           # Pure tick engines (zero DOM, zero Cesium)
│   ├── flight.svelte.ts  # FlightSimEngine — orbit, scenarios, cruise state machine
│   ├── motion.svelte.ts  # MotionEngine — turbulence, banking, breathing, vibration
│   ├── world.svelte.ts   # WorldEngine — weather randomization + flight director (slim)
│   └── scenarios.ts      # Flight path waypoint data + weighted picker
│
├── cesium/               # Globe render boundary (isolated Cesium dependency)
│   ├── manager.ts        # CesiumManager — viewer, terrain, imagery, camera, post-process
│   ├── config.ts         # Ion token, Mapbox/ESRI/Sentinel imagery URLs, tile server
│   ├── shaders.ts        # GLSL color grading
│   └── active.svelte.ts  # Reactive holder — published by Globe, consumed by geo effects
│
├── scene/                # Scene composition system — effects + content bundles
│   ├── types.ts          # Effect<TParams> contract + LayerKind
│   ├── compositor.svelte # Mounts merged static + dynamic effects in z-order
│   ├── registry.ts       # Static effects (clouds, lightning, micro-events, car-lights)
│   ├── bundle/           # Pushable content bundles
│   │   ├── types.ts      # ContentBundle union (VideoBgBundle | SpriteBundle) + WhenPredicate
│   │   ├── when.ts       # Pure evalWhen — predicate → boolean
│   │   ├── loader.ts     # createEffectFromBundle dispatcher + isContentBundle guard
│   │   ├── store.svelte.ts # Reactive bundleStore (install/remove/effects)
│   │   ├── client.ts     # hydrateFromServer / pushBundle / removeBundle (browser)
│   │   ├── disk.server.ts  # Filesystem persistence (server-only, node:fs)
│   │   └── assets.server.ts # Content-addressed asset storage (uploads)
│   └── effects/
│       ├── clouds/       # Wraps CloudBlobs.svelte
│       ├── lightning/    # Self-contained: timer + decay + flash visual
│       ├── micro-events/ # Self-contained: scheduler + wraps MicroEvent.svelte
│       ├── car-lights/   # First geo effect — Cesium Point entities, jugaad procedural
│       ├── video-bg/     # Parameterized: full-scene <video> from a bundle
│       └── sprite/       # Parameterized: Cesium Billboard at lat/lon
│
├── fleet/                # Remote Pi fleet management (bounded context)
│   ├── protocol.ts       # Wire message types (server ↔ display ↔ admin)
│   ├── transport.svelte.ts # BaseTransport — WS/SSE with $state + auto-reconnect
│   ├── client.svelte.ts  # Display → fleet server connection
│   ├── admin.svelte.ts   # Admin dashboard store (dual WS/SSE transport)
│   ├── hub.ts            # Server-side WS hub + SSE broadcast
│   └── url.ts            # Fleet endpoint resolver (dev override gated)
│
└── ui/                   # Svelte presentation components (chrome only)
    ├── Window.svelte     # Layer compositor — RAF tick, blind drag, mounts <Compositor/>
    ├── CloudBlobs.svelte # SVG feTurbulence 3-layer parallax (used by clouds effect)
    ├── Weather.svelte    # Rain + frost only (lightning moved into scene/effects/)
    ├── MicroEvent.svelte # Shooting stars/birds/contrails CSS (used by micro-events effect)
    ├── HUD.svelte        # Telemetry controls overlay
    ├── SidePanel.svelte  # Location picker + settings
    └── use-blind.svelte.ts # Composable — blind drag/snap controller

src/routes/playground/lib/  # Playground-only code (not in shared $lib)
├── globe/sources.ts       # Cesium + MapLibre imagery source catalog
└── maplibre/              # MapLibreGlobe.svelte + style.ts
```

**Test layout:** Tests live in `tests/` at repo root, mirroring `src/` paths
(e.g. `tests/lib/utils.test.ts` exercises `src/lib/utils.ts`). Import from
`$lib/*` — the alias resolves from any file. `vitest.config.ts`
`test.include` is `tests/**/*.{test,spec}.{ts,svelte.ts}`.

## Architecture

### WindowModel (app-state.svelte.ts) — Single Source of Truth

Single class holding all simulation state. Composes 3 engines. Provides context DI.

```typescript
model.flight      // FlightSimEngine — lat/lon/altitude/heading/warpFactor/flightMode
model.motion      // MotionEngine — motionOffsetX/Y, bankAngle, breathingOffset, engineVibeX/Y
model.world       // WorldEngine — weather randomizer + flight director (no effect state)

// Derived
model.currentLocation  // LOCATION_MAP.get(location)
model.skyState         // day|dawn|dusk|night
model.nightFactor      // 0-1
model.sceneFog         // per-location fog settings
model.terrainExaggeration // per-location (Himalayas 1.5x, cities 1.0x)
```

### Engine Design

Engines are **pure TypeScript classes with `$state` output fields**. Zero DOM, zero Cesium, independently testable. Each `tick()` accepts `SimulationContext` and returns a patch (or void).

**Intention pattern** — engines propose, coordinator disposes:
```typescript
const flightPatch = this.flight.tick(delta, ctx);
if (flightPatch.blindOpen !== undefined) this.blindOpen = flightPatch.blindOpen;
if (flightPatch.locationArrived)         this.setLocation(flightPatch.locationArrived);

const worldPatch = this.world.tick(delta, ctx);
if (worldPatch.atmosphere) this.applyPatch(worldPatch.atmosphere);
if (worldPatch.nextLocation) this.flight.flyTo(worldPatch.nextLocation);
```

### Tick Pipeline

```
Window.svelte (RAF loop via game-loop.ts)
└── model.tick(delta)
    ├── flight.tick(delta, ctx) → FlightPatch
    ├── motion.tick(delta, ctx) → void (mutates own $state)
    └── world.tick(delta, ctx) → WorldPatch
        ├── #tickRandomize → AtmospherePatch
        └── #tickDirector → LocationId

Scene effects subscribe to game-loop independently (lightning timer,
micro-event scheduler) — they're not driven by model.tick().
```

### Component Flow

```
+page.svelte (createAppState() sets context, owns side-effects, hydrates bundles)
└── useAppState() → model
    ├── Window.svelte (RAF tick, layer compositor)
    │   ├── Globe.svelte (CesiumManager — publishes activeCesium)
    │   ├── Compositor (mounts every Effect from registry + bundleStore in z-order)
    │   │   ├── clouds       (atmo z:1)  — wraps CloudBlobs
    │   │   ├── lightning    (atmo z:2)  — own state + visual
    │   │   ├── micro-events (atmo z:3)  — own scheduler + wraps MicroEvent
    │   │   ├── car-lights   (geo)       — Cesium points via activeCesium
    │   │   └── …bundles…    (dynamic)   — pushed via /api/content
    │   └── Weather.svelte (rain + frost)
    ├── HUD.svelte (telemetry overlay)
    └── SidePanel.svelte (settings)
```

### Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(2s)──→ cruise_transit ──(2s)──→ orbit
                   (warp ramp, blind closes)      (teleport, blind opens)
```

### CSS Layer System (z-order)

```
z:0   Cesium globe (terrain, buildings, dual-layer night lights, geo effects)
z:1   Clouds            (scene effect — SVG feTurbulence)
z:2   Rain              (Weather.svelte) + Lightning (scene effect — radial flash)
z:3   Micro-events      (scene effect — shooting star, bird, contrail)
z:5   Frost             (Weather.svelte)
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

Scene effects own their declared z (compositor sets `z-index` on the effect's
layer div). Geo effects (`kind: 'geo'`) render inside the Cesium canvas so
their z is inert at the compositor level.

### Imagery Sources (in priority order)

| Source | Auth | When to use |
|--------|------|-------------|
| **Local tile server** | `VITE_TILE_SERVER_URL` | Pi deployment — pre-fetched tiles |
| **Mapbox Satellite** | `VITE_MAPBOX_TOKEN` | Primary online — 50k req/mo free |
| **ESRI World Imagery** | None | Fallback — reliable, no auth |

## Key Patterns

### Type SSOT (types.ts)

All domain types derive from const arrays for both compile-time and runtime validation:
```typescript
export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = typeof WEATHER_TYPES[number];
// Same pattern for DISPLAY_MODES, QUALITY_MODES
```

### Context-Based State Access

```typescript
const model = createAppState();  // in +page.svelte only
const model = useAppState();     // in any descendant
```

Import `createAppState`/`useAppState` from `$lib/app-state.svelte`. Import types from `$lib/types`, constants from `$lib/constants`, etc.

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use `model`, `engine`, etc.

### Fleet Bounded Context

All fleet management lives in `fleet/`. The display client uses `FleetClientModel` (narrow interface in `fleet/protocol.ts`) — never imports WindowModel directly. Fleet files only import from `$lib/types`, `$lib/locations`, and sibling `./` files.

### User Override Pattern

`onUserInteraction(type)` pauses auto-behavior for 8 seconds via `UserOverrideTracker` — each flag (altitude/time/atmosphere) has its own independent timeout.

## Scene Composition System

The visual scene is built from **Effects** (`scene/types.ts`). Each effect is a self-contained Svelte component that:

- Owns its own `$state` — no global mutation of WindowModel
- Receives `{ model, params? }` as its only prop
- Subscribes to the game-loop directly via `$effect(() => subscribe(...))` if it needs ticking
- Mounts/unmounts via a `when` predicate evaluated against `model.*`

The **Compositor** (`scene/compositor.svelte`) iterates a merged list:

```
allEffects = [...EFFECTS (static), ...bundleStore.effects (dynamic)]
```

Adding a new **stock** effect = one folder under `scene/effects/<name>/` with `index.ts` exporting a default `Effect`, plus a line in `scene/registry.ts`. Zero changes to core, model, or compositor.

### Geo-positioned effects (Cesium-native)

Effects that need many world-positioned items (car lights, sprite billboards, passing planes) **must not** project lat/lon → screen in DOM. Use Cesium primitives via `activeCesium.manager`:

```typescript
import { activeCesium } from '$lib/cesium/active.svelte';

$effect(() => {
  const mgr = activeCesium.manager;  // reactive
  if (!mgr) return;
  const Cesium = mgr.getCesium();
  const viewer = mgr.getViewer();
  const ds = new Cesium.CustomDataSource('my-effect');
  viewer.dataSources.add(ds);
  // …add entities…
  return () => viewer.dataSources.remove(ds, true);
});
```

`Globe.svelte` publishes `activeCesium.manager` on mount, clears on destroy.

### Parameterized effect types (bundles)

A **BundleType** (currently `video-bg`, `sprite`) is a reusable effect renderer parameterized by a JSON manifest. The bundle loader (`scene/bundle/loader.ts`) dispatches on `bundle.type` to a factory that returns a configured `Effect`. New types are added by:

1. Extend `BundleType` union and `ContentBundle` union in `scene/bundle/types.ts`
2. Create `scene/effects/<type>/{types.ts, effect.svelte, factory.ts}`
3. Add a case in `loader.ts:createEffectFromBundle` (TypeScript exhaustiveness check enforces this)

## Content Push API

The device exposes its own HTTP server for content push — runs on the same port as the SvelteKit app.

### Endpoints

```
GET    /api/content                 → { bundles: ContentBundle[] }
POST   /api/content                 → { ok, id }   (body: ContentBundle JSON)
DELETE /api/content/[id]            → { ok } | 404

GET    /api/assets                  → { assets: AssetInfo[] }
POST   /api/assets                  → { ok, asset } (multipart, field 'file')
GET    /api/assets/[filename]       → file bytes with mime type
```

### Storage

```
data/bundles/<id>.json              # one file per installed bundle
data/assets/<sha256-prefix>.<ext>   # content-addressed (auto-dedupe)
```

Override directory via env vars:
```
AERO_BUNDLES_DIR=/var/aero/bundles
AERO_ASSETS_DIR=/var/aero/assets
```

### Bundle examples

```jsonc
// video-bg — full-scene MP4 loop behind clouds, only over Himalayas at night
{
  "id": "aurora-himalayas",
  "type": "video-bg",
  "kind": "atmo",
  "z": 0.5,
  "asset": "/api/assets/8a3f4d…webm",
  "opacity": 0.7,
  "blend": "screen",
  "when": { "location": ["himalayas"], "nightFactor": { "min": 0.3 } }
}

// sprite — Santa sleigh floating at 12,000 m, December only (when shipped with date predicate)
{
  "id": "santa-2026",
  "type": "sprite",
  "kind": "geo",
  "z": 5,
  "image": "/api/assets/4e8b1c…png",
  "lat": 25.2, "lon": 55.3,
  "altitude": 12000,
  "width": 96, "height": 48
}
```

### Web UI

`/content` — drag-drop a `.json` (becomes a bundle) or `.mp4`/`.png` (becomes an asset). Lists installed items. Upload returns the URL for the asset, copied to clipboard.

### Failure semantics

- Bundle endpoint unreachable on boot → silent. Stock effects render. The kiosk never blocks on content push.
- Bundle JSON malformed on disk → skipped with warning, others load.
- Asset file missing → effect mounts but shows nothing (browser handles missing video gracefully).

## Routes

- `/` — Main window display (production route for Pi kiosk)
- `/playground` — Isolated sandbox for rendering experiments (no WindowModel)
- `/content` — Drag-drop UI for installing content bundles + uploading assets (LAN-only)
- `/admin` — Fleet admin panel
- `/architecture` — Architecture visualization
- `/api/content` — Content bundle CRUD
- `/api/content/[id]` — Bundle delete
- `/api/assets` — Asset upload + list
- `/api/assets/[filename]` — Asset serve
- `/api/fleet` — Fleet server endpoint
- `/api/tiles/[...path]` — Tile proxy

## Environment Variables

```
VITE_CESIUM_ION_TOKEN=...     # Required for terrain/imagery (Cesium Ion)
VITE_MAPBOX_TOKEN=...         # Optional — enables Mapbox Satellite (50k/mo free)
VITE_TILE_SERVER_URL=...      # Optional — self-hosted tiles for offline
AERO_BUNDLES_DIR=...          # Server-side, default ./data/bundles. Set to /var/aero/bundles on Pi.
AERO_ASSETS_DIR=...           # Server-side, default ./data/assets. Set to /var/aero/assets on Pi.
```

## Build Configuration

- **Cesium assets**: copied via `vite-plugin-static-copy` to `/cesiumStatic`
- **Bundle**: `bundleStrategy: 'single'` for Pi deployment (enables inlineDynamicImports)
- **Adapter**: `adapter-node` (Bun serves the build)
- **CSP**: configured for Cesium Ion, Mapbox, ESRI, and fleet WS on any LAN host
- **SSR**: disabled (`export const ssr = false`)
- **TypeScript**: strict mode

## Pi 5 Deployment

- Hostname: `aero-display-00.local`
- Services: aero-xserver, aero-app (:5173), aero-kiosk (Chromium)
- Auto-starts on boot via systemd
- Chromium: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- CMA: 512MB, GPU turbo ready (needs fan)
