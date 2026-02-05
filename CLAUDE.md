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

## Tech Stack

- **Framework**: SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Terrain**: Cesium for real-world imagery and terrain
- **Styling**: Tailwind CSS v4 (via @tailwindcss/vite plugin)
- **State**: Context-based singleton with `setContext`/`getContext`

## Architecture

### CSS Layer System

The window uses Cesium for terrain and CSS for all effect overlays.

```
┌─────────────────────────────────────────┐
│ CSS: Vignette                      z:10 │
│ CSS: Glass imperfections            z:9 │
│ CSS: Cabin reflection               z:8 │
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
│  ├── OSM buildings (night window shader)│
│  └── Google 3D Tiles (optional)         │
└─────────────────────────────────────────┘
```

### Core Modules

- **`src/lib/core/WindowModel.svelte.ts`**: Simulation state — flight position, time, weather, physics, `tick()` (decomposed into `tickOrbit`, `tickLightning`, `tickMotion`, `tickAltitude`)
- **`src/lib/core/index.ts`**: Context provider (`createAppState`, `useAppState`) → returns `WindowModel` directly
- **`src/lib/core/constants.ts`**: Aircraft physics constants and tuning values

### Key Component Flow

```
+page.svelte
└── createAppState() → WindowModel
    └── Window.svelte (Layer Compositor + RAF tick loop + presentation $derived values)
        ├── CesiumViewer.svelte (terrain/buildings/NASA night lights/road glow)
        ├── CloudLayer.svelte (CSS blur gradients)
        ├── WeatherLayer.svelte (CSS rain + lightning)
        └── Controls.svelte (kiosk control panel)
```

### State Types

```typescript
type LocationId = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds' | 'hyderabad' | 'dallas' | 'phoenix' | 'las_vegas';
type SkyState = 'day' | 'night' | 'dawn' | 'dusk';
type WeatherType = 'clear' | 'cloudy' | 'overcast' | 'storm';
```

## Key Patterns

### Context-Based State Access

```typescript
// Creating (in +page.svelte)
const model = createAppState();

// Consuming (in any descendant component)
const model = useAppState();
```

### WindowModel Tick Pattern

The `WindowModel.tick(delta)` method handles all time-based simulation:
- Flight drift (lat/lon movement based on heading)
- Heading wander (natural heading variation)
- Lightning effects (weather)
- Motion offsets (turbulence/vibration)
- Auto-altitude adjustment for night

Window.svelte owns the single RAF loop that calls `model.tick(dt)`.

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use descriptive names like `windowModel`.

```typescript
// BAD - causes "Cannot use 'state' as a store" error
const state = useAppState();
let x = $state(0);

// GOOD
const appState = useAppState();
let x = $state(0);
```

### Derived Values

**WindowModel** (simulation derived):
- `localTimeOfDay`: Browser time → UTC → destination local time
- `skyState`: Time of day → day/night/dawn/dusk
- `effectiveCloudDensity`: Weather + user setting + night boost
- `nightAltitudeTarget`: Location + sky state → target altitude

**Window.svelte** (local presentation `$derived`):
- `skyBackground`, `filterString`: CSS values for sky rendering
- `sunGlareX/Y/Opacity`: Sun position and intensity
- `frostAmount`, `hazeOpacity`: Atmospheric effects
- `turbulenceY/Rotate`, `motionTransform`: Motion shake offsets
- `isNight`, `lightPollutionOpacity`, `glassVignetteOpacity`

## Environment Variables

Copy `.env.example` to `.env` and configure:
```
VITE_CESIUM_ION_TOKEN=...  # Required for Cesium terrain/imagery
VITE_BING_MAPS_API_KEY=...
VITE_MAPBOX_TOKEN=...
VITE_GOOGLE_MAPS_API_KEY=...
VITE_DEV_MAPS_ENABLED=true
```

## Vite Build Configuration

Manual chunks configured in `vite.config.ts` split:
- `cesium`: Cesium globe engine (largest)
- `ui-libs`: UI libraries (if any)

Chunk size warning limit set to 1500KB due to Cesium size.
