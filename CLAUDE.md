# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aero Dynamic Window is a **circadian-aware digital airplane window display** for office wellbeing. It renders a realistic airplane window view using Threlte (Three.js for Svelte) with GLSL shaders, syncing with real time of day. Designed for Raspberry Pi deployment with headless Chromium kiosk mode.

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
- **3D Rendering**: Threlte 8 (@threlte/core, @threlte/extras) wrapping Three.js
- **Styling**: Tailwind CSS v4 (via @tailwindcss/vite plugin)
- **Maps**: Azure Maps Control (optional real-world terrain)
- **State**: Context-based singleton with `setContext`/`getContext`

## Architecture

### Hybrid 3D/CSS Layer System

The window uses a hybrid approach: Threlte 3D canvas for realistic depth and CSS overlays for UI elements.

```
┌─────────────────────────────────────────┐
│ CSS: UI Controls (dev only)         z:60│
├─────────────────────────────────────────┤
│ CSS: Window Frame (static)          z:50│
├─────────────────────────────────────────┤
│ CSS: Blind (animated)               z:40│
├─────────────────────────────────────────┤
│ CSS: Events (Santa, birds...)       z:25│
├─────────────────────────────────────────┤
│ THRELTE CANVAS (3D scene)           z:0 │
│  ├── Sky3D (gradient shader sphere)     │
│  ├── StarField (night stars)            │
│  ├── SunEntity (sun light + mesh)       │
│  ├── Atmosphere (haze, god rays)        │
│  ├── Ground (horizon gradient)          │
│  ├── Clouds3D / CloudSprites            │
│  └── Wing3D (based on seat position)    │
└─────────────────────────────────────────┘
```

### Core Modules

- **`src/lib/core/state.svelte.ts`**: Central `WindowState` class managing all reactive state (flight, time, view, events, performance)
- **`src/lib/core/FlightModel.ts`**: Physics simulation for flight dynamics (turbulence, bank angle, heading, drift)
- **`src/lib/core/EnvironmentSystem.ts`**: Time-of-day calculations, biome color palettes per view
- **`src/lib/core/PerformanceManager.svelte.ts`**: Adaptive quality settings based on FPS

### Key Component Flow

```
+page.svelte
└── createWindowState() → Context Provider
    └── Window.svelte (Layer Compositor)
        ├── AzureMapLayer.svelte (optional real-world terrain)
        ├── Canvas (Threlte)
        │   └── Scene3D.svelte
        │       ├── EnhancedCamera.svelte
        │       ├── Sky3D.svelte
        │       ├── StarField.svelte
        │       ├── SunEntity.svelte
        │       ├── Atmosphere.svelte
        │       ├── Ground.svelte
        │       ├── Clouds3D.svelte / CloudSprites.svelte
        │       └── Wing3D.svelte
        └── Events.svelte (CSS overlays)
    └── Controls.svelte (Tweakpane dev UI)
```

### State Types

```typescript
type ViewType = 'dubai' | 'himalayas' | 'mumbai' | 'ocean' | 'desert' | 'clouds';
type SkyState = 'day' | 'night' | 'dawn' | 'dusk';
type EventType = 'christmas' | 'diwali' | 'newyear' | 'birds' | 'storm' | null;
type PerformanceMode = 'auto' | 'high' | 'mid' | 'low' | 'ultralow';
type WingVisibility = 'none' | 'full' | 'leading-edge' | 'trailing-edge';
```

## Key Patterns

### Svelte 5 Runes

```typescript
// State declaration
flight = $state<FlightState>({ ... });

// Derived values
skyState = $derived<SkyState>(this._environment.skyState);

// Effects with cleanup
$effect(() => {
  const interval = setInterval(fn, 1000);
  return () => clearInterval(interval);
});
```

### Context-Based State Access

```typescript
// Creating (in +page.svelte)
const windowState = createWindowState();

// Consuming (in any descendant component)
const windowState = getWindowState();
```

### CRITICAL: Variable Naming with Svelte 5

**Never name a variable `state` when using `$state` rune.** Use descriptive names like `windowState`.

```typescript
// BAD - causes "Cannot use 'state' as a store" error
const state = getWindowState();
let x = $state(0);

// GOOD
const windowState = getWindowState();
let x = $state(0);
```

### Performance-Adaptive Rendering

Components check `windowState.performanceMode` to switch between:
- `high/auto`: Full 3D clouds, atmosphere effects
- `mid/low`: Sprite-based clouds, simplified shaders
- `ultralow`: Video fallback mode

## GLSL Shaders

Custom shaders in `src/lib/shaders/index.ts` provide:
- **Terrain**: FBM noise for procedural elevation, biome-based coloring
- **Clouds**: Volumetric rendering with Henyey-Greenstein scattering, Beer's law absorption
- **Sky**: Gradient with sun disk, bloom, and atmospheric scattering
- **City**: Instanced buildings with window lights

## Environment Variables

Copy `.env.example` to `.env` and configure:
```
VITE_BING_MAPS_API_KEY=...
VITE_MAPBOX_TOKEN=...
VITE_GOOGLE_MAPS_API_KEY=...
VITE_DEV_MAPS_ENABLED=true
```

## Vite Build Configuration

Manual chunks configured in `vite.config.ts` split:
- `three`: Three.js core (largest)
- `threlte`: Threlte wrappers
- `ui-libs`: Tweakpane, Lucide icons

Chunk size warning limit set to 800KB due to Three.js size.
