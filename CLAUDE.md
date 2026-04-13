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

No test runner configured. No linter configured. Type checking is the primary validation tool.

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
│   ├── world.svelte.ts   # WorldEngine — weather, lightning, micro-events, auto-pilot
│   └── scenarios.ts      # Flight path waypoint data + weighted picker
│
├── cesium/               # Globe render boundary (isolated Cesium dependency)
│   ├── manager.ts        # CesiumManager — viewer, terrain, imagery, camera, post-process
│   ├── config.ts         # Ion token, Mapbox/ESRI/Sentinel imagery URLs, tile server
│   └── shaders.ts        # GLSL color grading
│
├── fleet/                # Remote Pi fleet management (bounded context)
│   ├── protocol.ts       # Wire message types (server ↔ display ↔ admin)
│   ├── transport.svelte.ts # BaseTransport — WS/SSE with $state + auto-reconnect
│   ├── client.svelte.ts  # Display → fleet server connection
│   ├── admin.svelte.ts   # Admin dashboard store (dual WS/SSE transport)
│   ├── hub.ts            # Server-side WS hub + SSE broadcast
│   └── url.ts            # Fleet endpoint resolver (dev override gated)
│
└── ui/                   # Svelte presentation components
    ├── Window.svelte     # Layer compositor — RAF tick, blind drag (useBlind)
    ├── Globe.svelte      # CesiumManager mount/destroy lifecycle
    ├── CloudBlobs.svelte # SVG feTurbulence 3-layer parallax
    ├── Weather.svelte    # Rain, lightning flash, frost (CSS)
    ├── TreeLayer.svelte  # Procedural CSS trees (seeded per location)
    ├── MicroEvent.svelte # Shooting stars, birds, contrails (CSS)
    ├── HUD.svelte        # Telemetry controls overlay
    ├── SidePanel.svelte  # Location picker + settings
    └── use-blind.svelte.ts # Composable — blind drag/snap controller
```

## Architecture

### WindowModel (app-state.svelte.ts) — Single Source of Truth

Single class holding all simulation state. Composes 3 engines. Provides context DI.

```typescript
model.flight      // FlightSimEngine — lat/lon/altitude/heading/warpFactor/flightMode
model.motion      // MotionEngine — motionOffsetX/Y, bankAngle, breathingOffset, engineVibeX/Y
model.world       // WorldEngine — lightningIntensity, microEvent, resetDirector()

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
        ├── #tickLightning → lightningIntensity/X/Y
        ├── #tickRandomize → AtmospherePatch
        ├── #tickEvents → microEvent
        └── #tickDirector → LocationId
```

### Component Flow

```
+page.svelte (createAppState() sets context, owns side-effects)
└── useAppState() → model
    ├── Window.svelte (RAF tick, layer compositor, useBlind composable)
    │   ├── Globe.svelte (Cesium terrain/buildings — CesiumManager lifecycle)
    │   ├── CloudBlobs.svelte (SVG feTurbulence clouds)
    │   ├── Weather.svelte (rain, lightning, frost — CSS)
    │   ├── TreeLayer.svelte (procedural CSS trees, seeded per location)
    │   └── MicroEvent.svelte (shooting star, bird, contrail — CSS)
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
z:0   Cesium globe (terrain, buildings, night lights)
z:1   CloudBlobs (SVG feTurbulence + CSS drift)
z:2   Weather (rain drops + lightning flash)
z:3   Micro-events (shooting star, bird, contrail)
z:4   TreeLayer (procedural CSS trees)
z:5   Frost (altitude-dependent)
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

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

## Routes

- `/` — Main window display (production route for Pi kiosk)
- `/playground` — Isolated sandbox for rendering experiments (no WindowModel)
- `/admin` — Fleet admin panel
- `/architecture` — Architecture visualization
- `/api/fleet` — Fleet server endpoint
- `/api/tiles/[...path]` — Tile proxy

## Environment Variables

```
VITE_CESIUM_ION_TOKEN=...     # Required for terrain/imagery (Cesium Ion)
VITE_MAPBOX_TOKEN=...         # Optional — enables Mapbox Satellite (50k/mo free)
VITE_TILE_SERVER_URL=...      # Optional — self-hosted tiles for offline
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
- Services: aero-app (:5173), aero-fleet (:3001), aero-kiosk (Chromium)
- Auto-starts on boot via systemd
- Chromium: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- CMA: 512MB, GPU turbo ready (needs fan)
