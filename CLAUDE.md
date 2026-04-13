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
- **Clouds**: SVG feTurbulence + CSS animation (no WebGL shader)
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks
- **State**: Context-based singleton (`setContext`/`getContext`) + composed engine classes
- **Build**: Vite 7, adapter-node, bundleStrategy:'single', SSR disabled

## Architecture

### WindowModel (app-state.svelte.ts) — Single Source of Truth

Single class holding all simulation state. Composes 3 engines. Provides context DI via `createAppState()`/`useAppState()`.

```typescript
model.flight      // FlightSimEngine — lat/lon/altitude/heading/warpFactor/flightMode
model.motion      // MotionEngine — motionOffsetX/Y, bankAngle, breathingOffset, engineVibeX/Y
model.world       // WorldEngine — lightningIntensity, microEvent, resetDirector()

// Derived
model.currentLocation  // LOCATION_MAP.get(location)
model.localTimeOfDay   // timeOfDay + utcOffset
model.skyState         // day|dawn|dusk|night
model.nightFactor      // 0-1
```

### Engine Design

Engine modules are **pure TypeScript classes with `$state` output fields**. Zero DOM dependencies, zero Cesium references, independently testable.

Each engine's `tick()` accepts a narrow **context interface** (not the full model):
```typescript
interface ISimulationEngine<TContext, TPatch> {
    tick(delta: number, ctx: TContext): TPatch;
}
```

**WorldEngine** uses the **intention pattern** — returns a `WorldPatch` (atmosphere changes, next location), coordinator decides whether to apply:
```typescript
const worldPatch = this.world.tick(delta, ctx);
if (worldPatch.atmosphere) this.applyPatch(worldPatch.atmosphere);
if (worldPatch.nextLocation) this.flight.flyTo(worldPatch.nextLocation);
```

### Tick Pipeline

```
Window.svelte (RAF loop via game-loop.svelte)
└── model.tick(delta)
    ├── flight.tick(delta, ctx)
    ├── motion.tick(delta, ctx + turbulenceLevel)
    └── world.tick(delta, ctx + showLightning, isOrbitMode, pickNextLocation)
        ├── #tickLightning → lightningIntensity/X/Y
        ├── #tickRandomize → AtmospherePatch (cloudDensity/speed/haze/weather)
        ├── #tickEvents → microEvent (bird/shooting-star/contrail)
        └── #tickDirector → LocationId (auto-pilot)
```

### Component Flow

```
+page.svelte (createAppState() sets context, owns side-effects)
└── useAppState() → model
    ├── Window.svelte (RAF tick, layer compositor, blind drag)
    │   ├── Globe.svelte (Cesium terrain/buildings)
    │   ├── CloudBlobs.svelte
    │   ├── Weather.svelte
    │   └── MicroEvent.svelte
    ├── HUD.svelte (telemetry overlay)
    └── SidePanel.svelte (settings)
```

**+page.svelte** owns side-effects (real-time clock sync, debounced auto-save, fleet WS connection, URL param config) — kept out of WindowModel for testability.

### Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(2s)──→ cruise_transit ──(2s)──→ orbit
                   (warp ramp, blind closes)      (teleport, blind opens)
```

Director triggers `flyTo()` every 2-5 minutes, weighted by time of day.

### CSS Layer System (z-order)

```
z:0   Cesium globe (terrain, buildings, night lights)
z:1   CloudBlobs (SVG feTurbulence + CSS drift)
z:2   Weather (rain drops + lightning flash)
z:3   Micro-events (shooting star, bird, contrail)
z:5   Frost (altitude-dependent)
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

### User Override Pattern

`onUserInteraction(type)` pauses auto-behavior for 8 seconds, preventing auto-pilot and ambient randomizer from fighting user input.

## Key Patterns

### Context-Based State Access

```typescript
const model = createAppState();  // in +page.svelte only
const model = useAppState();     // in any descendant
```

All imports from `$lib/app-state.svelte` — it barrel-exports types, constants, and locations.

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use `model`, `engine`, etc.

### Game Loop (game-loop.svelte.ts)

Singleton RAF loop with subscriber pattern. Auto-starts when first subscriber registers, stops when last unsubscribes. Includes visibility check (pauses when tab hidden — saves CPU on Pi kiosk) and error recovery (reloads page after 10 consecutive errors).

### CesiumManager (cesium-manager.ts)

Flat class handling all Cesium concerns: viewer lifecycle, terrain, buildings, imagery, atmosphere sync, post-processing, camera. Receives a `CesiumModelView` interface (not WindowModel directly) to stay decoupled.

## Routes

- `/` — Main window display (production route for Pi kiosk)
- `/playground` — Isolated sandbox for cloud rendering experiments (no WindowModel)
- `/admin` — Fleet admin panel
- `/architecture` — Architecture visualization
- `/api/fleet` — Fleet server endpoint
- `/api/tiles/[...path]` — Tile proxy

## Environment Variables

```
VITE_CESIUM_ION_TOKEN=...     # Required for terrain/imagery (Cesium Ion)
VITE_TILE_SERVER_URL=...      # Optional, self-hosted tiles for offline
```

## Build Configuration

- **Cesium assets**: copied via `vite-plugin-static-copy` to `/cesiumStatic`
- **Bundle**: `bundleStrategy: 'single'` for Pi deployment (enables inlineDynamicImports)
- **Adapter**: `adapter-node` (Bun serves the build)
- **CSP**: configured for Cesium Ion, map tile providers, and fleet WS on any LAN host
- **SSR**: disabled (`export const ssr = false`)
- **TypeScript**: strict mode

## Pi 5 Deployment

- Hostname: `aero-display-00.local`
- Services: aero-app (:5173), aero-fleet (:3001), aero-kiosk (Chromium)
- Auto-starts on boot via systemd
- Chromium: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- CMA: 512MB, GPU turbo ready (needs fan)
