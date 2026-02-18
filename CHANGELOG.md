# Changelog

All notable changes to Sky Portal (Aero Dynamic Window) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.5.0] - 2026-02-15

### Added
- Custom 3-pass selective night bloom on city lights using Cesium PostProcessStage pipeline
- Loading indicator with fade-out transition while Cesium initializes
- Error fallback UI with retry button when Cesium fails to load
- HUD contrast gradient behind Controls for readability against bright skies
- Aria-live announcements for flight location transitions (screen reader support)
- Keyboard focus trap in SidePanel with Tab wrapping and Escape to close
- Blind handle discoverability animation (3-cycle breathe pulse on first load)
- Extracted GLSL shaders to dedicated `cesium-shaders.ts` module (CesiumViewer 1052 to 795 lines)

### Changed
- Decomposed `initCesium` into 4 focused helper functions for maintainability
- SidePanel exit now uses slide-out animation (200ms) matching the slide-in

### Fixed
- GLSL `step` built-in name shadow: renamed `vec2 step` to `texelSize`
- HMR cache type mismatches and orphaned cache fields in CesiumViewer
- `prevTransitioning` changed from `$state` rune to plain JS variable (no reactivity needed)
- Removed stray `console.error`; added `localStorage.clear()` before error reload
- Removed unused `WeatherEffect` type export from barrel

## [0.4.0] - 2026-02-05

### Added
- SidePanel component with full settings: atmosphere, lighting, weather, and location controls
- NASA VIIRS night lights via ungated GIBS endpoint (no API key required)
- Warm sodium/amber color grading shader for realistic city light tones
- Physics-based warp speed mode (100x orbit acceleration)
- Location-aware atmosphere density, fog falloff, and terrain LOD tuning
- Reusable `RangeSlider` and `Toggle` control components
- `AirlineLoader` component for loading screen branding
- State persistence module (`persistence.ts`) for saving user preferences
- Locations data module (`locations.ts`) with curated destination presets
- `prefers-reduced-motion` media query support throughout all animations
- JetBrains Mono font loading for HUD typography
- Touch targets enlarged to 44px minimum for Raspberry Pi kiosk use
- Timed click-hint interaction model (replaces hover, better for touchscreens)
- Blind handle grip texture for tactile affordance
- Responsive HUD padding and 4K display support
- Panel slide-in animation for SidePanel

### Changed
- Architecture overhaul: consolidated to pure CSS layer system, removed Three.js 3D scene overlay entirely
- Removed Threlte plugins (`daynight`, `selectiveBloom`, `turbulence`) in favor of CSS-driven effects
- Removed GLSL shader modules (`common.glsl.ts`, `volumetricClouds.ts`) and shader index
- Removed `EnvironmentSystem.ts`, `Scene3DOverlay.svelte`, and all `3d/` layer components
- Removed `cesium-augmentations.d.ts` type declarations (no longer needed without Three.js)
- Simplified dependency tree: dropped `@threlte/*`, `three`, and related packages
- Updated CLAUDE.md architecture documentation to reflect CSS layer system
- Blind text contrast improved with SW blue branding color scheme

### Removed
- Three.js scene overlay (`Scene3DOverlay.svelte`) and all 3D sub-components (`CityLights`, `EnhancedWing`, `Scene`, `VolumetricClouds`, `WeatherEffects`)
- Threlte plugin system (`daynight.svelte.ts`, `selectiveBloom.svelte.ts`, `turbulence.svelte.ts`)
- GLSL shader modules and shader barrel export
- `app.css` global stylesheet (replaced by Tailwind)
- `EnvironmentSystem.ts` (functionality merged into WindowModel)
- `math-utils.ts` and `time-utils.ts` (consolidated into `utils.ts`)

## [0.3.0] - 2026-01-26

### Added
- Cloud speed and cloud scale user controls with sliders
- Destination local time and sky state display in Controls HUD
- Auto-altitude adjustment at night (48k ft) and dawn/dusk (42k ft) for optimal city light viewing
- Night cloud density boost (30% increase during night and dusk)
- `nightAltitudeTarget` derived property on WindowModel
- `effectiveCloudDensity` derived from weather state, user setting, and time-of-day

### Changed
- Maximum altitude ceiling raised from 50,000 ft to 65,000 ft
- Volumetric clouds rewritten as 3D-positioned meshes with parallax depth
- Clouds now drift sideways (front-to-back) simulating a side window perspective
- Scale caching on cloud meshes to avoid unnecessary matrix updates
- Updated ARCHITECTURE.md for Cesium + Three.js hybrid documentation
- Rewrote STATE_API_REFERENCE.md to document the WindowModel API

### Fixed
- Lightning timer floating-point comparison bug (`< 0.01` instead of `=== 0`)
- Removed unused `_transitionProgress` variable
- Cleaned up dead code and outdated comments in Scene.svelte

## [0.2.0] - 2026-01-04

### Added
- NASA Earth at Night imagery layer in Cesium for geo-located city lights
- Altitude-based night light opacity: subtle below 15k ft, peak at 30-45k ft
- Multi-layer rain depth effect (far, near, and heavy drop layers)
- Wind angle simulation for rain with turbulence offset
- Weather-adjusted cloud colors (darker tones during storms)
- Wind-influenced cloud drift based on aircraft heading
- Altitude-aware cloud sizing
- Time-of-day fog brightness variation
- Storm-triggered heavy rain drops layer

### Changed
- City lights switched from Three.js `CityLights` component to Cesium NASA imagery (proper geo-location sync)
- Night gamma inversion fixed (was brightening instead of darkening the scene)
- Night minimum brightness raised to 20% (was 5%, resulting in pitch black)
- Night lights max opacity boosted to 55% (was 25%)
- Default terrain darkness lowered to 0.60 (was 0.95, too dark)
- Haze formula replaced: exponential with curved scaling and altitude attenuation
- Rain visibility improved (alpha 0.25 to 0.45)
- Atmosphere kept enabled at night for depth cues
- CityLights positioned at fixed ground level (-10000) for stable rendering

### Fixed
- City lights "firefly" jitter caused by dynamic offset tracking
- Night scene too dark due to incorrect gamma calculation
- Haze not accounting for altitude or weather state

### Removed
- Three.js CityLights component (cannot sync with Cesium world coordinates)
- Nav lights and strobe on EnhancedWing (wing not visible at current camera angle)
- Sky and Stars from 3D scene (were covering the Cesium terrain layer)

## [0.1.0] - 2025-12-22

### Added
- WindowModel as Single Source of Truth for all simulation state
- Context-based state management with `createAppState`/`useAppState` (Svelte 5 `setContext`/`getContext`)
- Threlte plugins: turbulence (camera shake), daynight (lighting transitions), selectiveBloom (HDR city glow)
- Flight drift movement with layered noise for natural, organic motion
- CityLights component with HDR colors optimized for selective bloom
- Accurate timezone calculations using destination latitude for sun position
- Heading normalization to 0-360 degree range
- State API reference and consolidation documentation

### Changed
- Lowered camera sync debounce thresholds for smoother Cesium movement
- Reduced default haze for clearer terrain visibility

### Removed
- `FlightSimulation.svelte.ts` (merged into WindowModel)
- `MotionSystem.svelte.ts` (merged into WindowModel)
- `state.svelte.ts` (replaced by WindowModel)
- `MotionUpdater.svelte` (obsolete with new tick architecture)

## [0.0.1] - 2025-12-16

### Added
- Initial project scaffold: SvelteKit 2, Svelte 5, Cesium, Three.js, Tailwind CSS v4
- Cesium terrain viewer with ESRI imagery, OSM 3D buildings, and tile caching
- Three.js overlay for wing model, volumetric clouds, and weather effects
- Real-time flight simulation with configurable drift mode
- Time-of-day based sky states (day, night, dawn, dusk) with CSS sky gradients
- Weather effects: rain streaks, lightning flashes, contrails
- Interactive window blind with open/close animation
- City/location switching with camera fly-to transitions
- Controls panel with altitude, speed, weather, and location settings
- GLSL volumetric cloud shaders
- Boeing 737 wing GLTF model
- Vite build with Cesium chunk splitting
- Raspberry Pi kiosk deployment target
