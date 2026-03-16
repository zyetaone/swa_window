# Aero Dynamic Window — Project Overview

## Purpose
Circadian-aware airplane window display for Southwest Airlines. Renders realistic airplane window view using Cesium terrain with CSS effect layers, syncs with real time of day. Target: Pi 5 kiosk deployment.

## Tech Stack
- SvelteKit 2 + Svelte 5 runes ($state, $derived, $effect)
- Cesium for real-world terrain/imagery
- Tailwind CSS v4, component-scoped styles
- Vite 7, SSR disabled
- TypeScript strict mode

## Key Files
- `src/lib/core/WindowModel.svelte.ts` — All simulation state, tick methods, flight FSM
- `src/lib/core/constants.ts` — Tuning values (FLIGHT_FEEL, AIRCRAFT, etc.)
- `src/lib/core/locations.ts` — Location definitions, LOCATION_MAP
- `src/lib/core/types.ts` — LocationId, SkyState, WeatherType types
- `src/lib/core/flight-scenarios.ts` — Waypoint-based flight paths per location
- `src/lib/layers/CesiumViewer.svelte` — Cesium init, post-processing, terrain
- `src/lib/layers/cesium-shaders.ts` — Color grading GLSL shader
- `src/lib/layers/Window.svelte` — Layer compositor, RAF loop, CSS effects

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build
- `npm run check` — TypeScript + Svelte check (svelte-check)
- No test runner or linter configured

## Patterns
- Context-based state: `createAppState()` / `useAppState()`
- Never name a variable `state` with `$state` rune
- Simulation derived → WindowModel, presentation derived → Window.svelte
- Flight mode FSM: orbit → cruise_departure → cruise_transit → orbit
