# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view using Cesium for terrain with CSS effect layers, syncing with real time of day. Designed for Raspberry Pi 5 fleet deployment with headless Chromium kiosk mode.

## Commands

```bash
bun run dev          # Start development server (Vite)
bun run build        # Build for production
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run check:watch  # Type check in watch mode
```

No test runner is configured. No linter is configured.

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Terrain**: Cesium.js for real-world imagery, terrain, 3D buildings
- **Clouds**: SVG feTurbulence + CSS animation (no WebGL shader)
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks
- **State**: Context-based singleton (`setContext`/`getContext`) + composed engine classes
- **Build**: Vite 7, adapter-node, bundleStrategy:'single', SSR disabled

## Architecture

```
src/lib/
├── engine/                  # Pure simulation (zero DOM, zero Svelte)
│   ├── FlightSim.svelte.ts      Position, orbit, waypoint scenarios, cruise state machine
│   ├── Motion.svelte.ts          Turbulence, banking, breathing, engine vibe
│   ├── Atmosphere.svelte.ts      Lightning + ambient randomization
│   ├── Director.svelte.ts        Auto-pilot city picker (returns intention, not side-effect)
│   ├── Events.svelte.ts          Micro-events (shooting stars, birds, contrails)
│   ├── loop.svelte.ts            Global RAF loop (subscriber pattern)
│   ├── flight-scenarios.ts       Waypoint data for 10+ cities
│   └── cesium/                   Globe rendering bridge
│       ├── Globe.svelte              Mount/destroy lifecycle
│       ├── manager.ts                6 inner classes (terrain, imagery, atmosphere, buildings, camera, post-process)
│       └── shaders.ts                GLSL color grading
│
├── components/              # Svelte UI components
│   ├── Window.svelte            Layer compositor (Cesium + clouds + effects)
│   ├── SidePanel.svelte         Settings panel (location, weather, time, sliders)
│   ├── HUD.svelte               Controls overlay
│   ├── Blind.svelte             Draggable window blind (pointer events)
│   ├── CloudBlobs.svelte        SVG feTurbulence clouds (3-depth parallax)
│   ├── Weather.svelte           Rain, lightning, frost
│   ├── MicroEvent.svelte        Sky event animations
│   ├── AirlineLoader.svelte     Loading screen
│   ├── RangeSlider.svelte       Reusable slider control
│   └── Toggle.svelte            Reusable toggle control
│
├── core/                    # State coordination + fleet clients
│   ├── index.ts                 Barrel: createAppState(), useAppState()
│   ├── WindowModel.svelte.ts    Thin coordinator — composes engine modules
│   ├── fleet-client.svelte.ts   Display WebSocket client (auto-connect, status heartbeat)
│   └── fleet-admin.svelte.ts    Admin WS/SSE transport (dual-transport, REST actions)
│
└── shared/                  # Canonical types + constants
    ├── constants.ts             AIRCRAFT, FLIGHT_FEEL, CESIUM, WEATHER_EFFECTS, AMBIENT, MICRO_EVENTS
    ├── types.ts                 SkyState, LocationId, WeatherType, Location
    ├── locations.ts             18 cities with lat/lon/altitude/hasBuildings
    ├── protocol.ts              Fleet WebSocket message types
    ├── persistence.ts           localStorage save/load with validation
    ├── utils.ts                 clamp, lerp, normalizeHeading, formatTime
    └── index.ts                 Barrel exports

server/                      # Fleet hub (separate Bun process)
└── src/
    ├── index.ts                 HTTP + WebSocket server entry
    └── ws.ts                    Device registry, message routing, SSE

deploy/                      # Pi provisioning + OTA
├── provision-pi.sh              First-time Pi setup
├── aero-updater.sh              OTA update script (git pull + rebuild)
└── README.md
```

### Engine Design

Engine modules are **pure TypeScript classes with `$state` output fields**. They have zero DOM dependencies, zero Cesium references, and are independently testable.

Each engine's `tick()` method accepts a narrow **context interface** (not the full model):
```typescript
motion.tick(delta, { time, heading, altitude, weather, turbulenceLevel })
director.tick(delta, { userAdjusting, pickNextLocation })  // returns LocationId | null
atmosphere.tickRandomize(delta, { userAdjusting, cloudDensity, ... })  // returns patch | null
```

Director and Atmosphere use the **intention pattern** — they return what they want to do, the coordinator decides whether to execute.

WindowModel composes all engines and provides **proxy getters/setters** so consumers access state through `model.altitude` without knowing which engine owns it.

### Component Flow

```
+page.svelte (context provider + side-effects)
└── createAppState() → WindowModel
    ├── Window.svelte (layer compositor — subscribes to RAF loop)
    │   ├── Globe.svelte (Cesium terrain/buildings/night lights)
    │   ├── CloudBlobs.svelte (SVG feTurbulence clouds)
    │   ├── Weather.svelte (rain, lightning, frost)
    │   ├── MicroEvent.svelte (shooting stars, birds, contrails)
    │   └── Blind.svelte (draggable window blind)
    ├── HUD.svelte (controls overlay)
    └── SidePanel.svelte (settings panel)
```

### State Ownership

**WindowModel** (coordinator): composes engines, owns shared state (timeOfDay, weather, cloudDensity, blindOpen, displayMode), dispatches `tick()`.

**Engine modules** (via proxy): FlightSim owns position/heading/altitude. Motion owns turbulence/banking. Atmosphere owns lightning. Events owns micro-events. Director owns auto-pilot timer.

**+page.svelte** (side-effects): real-time clock sync, debounced auto-save, fleet WS connection, URL param config.

### Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(2s)──→ cruise_transit ──(2s)──→ orbit
                   (warp ramp, blind closes)  (teleport, blind opens)
```

Director triggers `flyTo()` every 2-5 minutes, weighted by time of day (nature mornings, cities midday/night).

### CSS Layer System (z-order)

```
z:0   Cesium globe (terrain, buildings, night lights, post-process)
z:1   CloudBlobs (SVG feTurbulence + CSS drift animation)
z:2   Weather (rain drops + lightning flash)
z:3   Micro-events (shooting star, bird, contrail)
z:5   Frost (altitude-dependent)
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

## Key Patterns

### Context-Based State Access

```typescript
const model = createAppState();  // in +page.svelte only
const model = useAppState();     // in any descendant
```

### Engine Composition (proxy delegation)

```typescript
class WindowModel {
    private readonly flight = new FlightSimEngine(callbacks);
    private readonly motion = new MotionEngine();
    get altitude() { return this.flight.altitude; }
    set altitude(v: number) { this.flight.altitude = v; }
    get bankAngle() { return this.motion.bankAngle; }
}
```

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use `model`, `engine`, etc.

### User Override Pattern

`onUserInteraction(type)` pauses auto-behavior for 8 seconds, preventing auto-pilot and ambient randomizer from fighting user input.

## Environment Variables

```
VITE_CESIUM_ION_TOKEN=...           # Required for terrain/imagery
VITE_GOOGLE_MAPS_API_KEY=...        # Optional, Google 3D Tiles
VITE_TILE_SERVER_URL=...            # Optional, self-hosted tiles for offline
GOOGLE_GENAI_API_KEY=...            # Build-time only, texture generation
```

## Build Configuration

- **Cesium assets**: copied via `vite-plugin-static-copy` to `/cesiumStatic`
- **Bundle**: `bundleStrategy: 'single'` for Pi deployment
- **Adapter**: `adapter-node` (Bun serves the build)
- **CSP**: configured for cross-port fleet server communication
- **SSR**: disabled (`export const ssr = false`)
- **TypeScript**: strict mode, `noUnusedLocals`, `noUnusedParameters`

## Pi 5 Deployment

- Hostname: `aero-display-00.local`
- Services: aero-app (:5173), aero-fleet (:3001), aero-kiosk (Chromium)
- Auto-starts on boot via systemd
- Chromium: `--kiosk --use-gl=angle --use-angle=gles --enable-webgl`
- CMA: 512MB, GPU turbo ready (needs fan)
