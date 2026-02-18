# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view using Cesium for terrain with CSS effect layers, syncing with real time of day. Designed for Raspberry Pi deployment with headless Chromium kiosk mode.

## Commands

```bash
npm run dev          # Start development server (Vite)
npm run build        # Build for production
npm run preview      # Preview production build
npm run check        # Type check with svelte-check
npm run check:watch  # Type check in watch mode
```

No test runner is configured. No linter is configured.

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Terrain**: Cesium for real-world imagery and terrain
- **Styling**: Tailwind CSS v4 (via @tailwindcss/vite plugin), component-scoped `<style>` blocks
- **State**: Context-based singleton with `setContext`/`getContext`
- **Build**: Vite 7, SSR disabled (`+page.ts` exports `ssr = false`)

## Architecture

### CSS Layer System

The window uses Cesium for terrain and CSS for all effect overlays.

```
┌─────────────────────────────────────────┐
│ CSS: Glass recess rim              z:11 │
│ CSS: Vignette                      z:10 │
│ CSS: Glass vignette                 z:9 │
│ CSS: Wing silhouette                z:7 │
│ CSS: Frost                          z:5 │
│ CSS: Micro-events (star/bird/trail) z:3 │
│ CSS: Weather (rain + lightning)     z:2 │
│ CSS: Clouds (blur gradients)        z:1 │
├─────────────────────────────────────────┤
│ CESIUM VIEWER (terrain base)        z:0 │
│  ├── Real-world imagery (ESRI)          │
│  ├── NASA Black Marble (night lights)   │
│  ├── CartoDB Dark (road glow at night)  │
│  ├── 3D terrain elevation               │
│  ├── Color grading post-process         │
│  └── Built-in bloom (night, TODO)       │
└─────────────────────────────────────────┘
```

### Core Modules

- **`src/lib/core/WindowModel.svelte.ts`**: Single source of truth — flight position, time, weather, physics, all `tick*()` methods, flight mode state machine
- **`src/lib/core/index.ts`**: Context provider (`createAppState`, `useAppState`) + re-exports of types, constants, locations
- **`src/lib/core/constants.ts`**: All tuning values — `AIRCRAFT`, `FLIGHT_FEEL`, `MICRO_EVENTS`, `AMBIENT`, `CESIUM`, `WEATHER_EFFECTS`
- **`src/lib/core/persistence.ts`**: localStorage save/load with validation (key: `aero-window-v2`)
- **`src/lib/core/locations.ts`**: Location definitions with `LOCATION_MAP` for O(1) lookups
- **`src/lib/layers/cesium-shaders.ts`**: GLSL color grading post-process shader (night city light tinting)

### Component Flow

```
+page.svelte
└── createAppState() → WindowModel (context set)
    ├── Window.svelte (Layer compositor + RAF tick loop + presentation $derived values)
    │   └── CesiumViewer.svelte (terrain/buildings/NASA night lights/road glow/post-processing)
    ├── Controls.svelte (HUD overlay when blind open, branding when blind closed)
    └── SidePanel.svelte (slide-out settings: location picker, sliders, weather)
```

### State Ownership

**WindowModel** owns all simulation state and derived values:
- `$state` fields: position, time, weather, flight mode, motion offsets, micro-events
- `$derived` fields: `skyState`, `nightFactor`, `dawnDuskFactor`, `effectiveCloudDensity`, `nightAltitudeTarget`, `isTransitioning`
- `tick(delta)`: Single entry point called by Window.svelte RAF loop. Dispatches to: `tickOrbit`, `tickDeparture`, `tickTransit`, `tickDirector`, `tickLightning`, `tickMotion`, `tickAltitude`, `tickMicroEvents`, `tickRandomize`
- Actions: `flyTo()`, `setLocation()`, `applyPatch()`, `pickNextLocation()`

**Window.svelte** owns presentation derivations (local `$derived` values):
- `skyBackground`, `filterString`: CSS values for sky rendering
- `frostAmount`, `motionTransform`: Atmospheric and motion effects
- All clouds, rain, lightning CSS are inlined in Window.svelte (not separate components)

**+page.svelte** owns side-effects:
- Real-time clock sync (`$effect` with setInterval)
- Debounced auto-save to localStorage (`$effect`)
- URL search params for device-specific config (`?location=dubai&altitude=30000`)

### Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(2s)──→ cruise_transit ──(2s)──→ orbit
                   (warp ramp up,              (teleport location,
                    blind closes)               blind opens)
```

The Director auto-pilot (`tickDirector`) triggers `flyTo()` every 2-5 minutes during orbit mode.

### Cesium Initialization Pattern

`CesiumViewer.svelte` uses an HMR cache (`globalThis.__CESIUM_HMR_CACHE__`) to persist the Cesium viewer across Vite hot reloads. Initialization uses Svelte 5's `{@attach}` directive and an `AbortController` for cleanup. Post-processing uses a custom color grading GLSL shader. Night rendering works via full-brightness grayscale terrain with NASA Black Marble lights, tinted warm by the color grading shader. 3D buildings are currently disabled (Ion OSM buildings' `CESIUM_primitive_outline` extension conflicts with imagery draping).

### State Types

```typescript
type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas';
type SkyState = 'day' | 'night' | 'dawn' | 'dusk';
type WeatherType = 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm';
type FlightMode = 'orbit' | 'cruise_departure' | 'cruise_transit';
```

## Key Patterns

### Context-Based State Access

```typescript
// Creating (in +page.svelte only)
const model = createAppState();

// Consuming (in any descendant component)
const model = useAppState();
```

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use descriptive names like `windowModel`.

```typescript
// BAD - causes "Cannot use 'state' as a store" error
const state = useAppState();
let x = $state(0);

// GOOD
const model = useAppState();
let x = $state(0);
```

### Derived Value Split

Simulation-level derived values go in `WindowModel.svelte.ts` as class fields. Presentation-level derived values (CSS strings, pixel offsets) stay local in Window.svelte as `$derived` declarations. This keeps the model testable and the presentation co-located with the template.

### User Override Pattern

When the user adjusts a setting (altitude, time, atmosphere), `onUserInteraction(type)` sets a flag that pauses the corresponding auto-behavior for 8 seconds. This prevents the auto-pilot and ambient randomizer from fighting user input.

## Environment Variables

Copy `.env.example` to `.env` and configure:
```
VITE_CESIUM_ION_TOKEN=...       # Required for Cesium terrain/imagery
VITE_GOOGLE_MAPS_API_KEY=...    # Optional, enables Google 3D Tiles
```

## Build Configuration

- **Cesium static assets** are copied via `vite-plugin-static-copy` to `/cesiumStatic`
- **Manual chunks**: Cesium is split into its own chunk (`cesium`)
- **Chunk size warning** set to 5000KB due to Cesium size
- **SSR disabled** via `+page.ts` (`export const ssr = false`) because Cesium requires browser APIs
- **TypeScript**: Strict mode with all strict flags enabled, `noUnusedLocals`, `noUnusedParameters`
