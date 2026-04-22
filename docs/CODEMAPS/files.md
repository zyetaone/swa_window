# File Inventory

**Last Updated:** 2026-04-14  
**Total:** ~8,100 lines across 44 files

## src/lib/ — Core Library

### app-state.svelte.ts (376 lines)
AeroWindow class + context DI. Composes engines, owns shared reactive state, tick pipeline.
- **Exports:** `AeroWindow`, `AeroWindowPatch`, `createAeroWindow()`, `useAeroWindow()`
- **Imports:** shared/*, engine/*, services/persistence

### engine/ — Pure Simulation (zero DOM)

| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| flight-engine.svelte.ts | 255 | `FlightSimEngine`, `FlightMode`, `FlightCallbacks` | Orbit, scenarios, cruise state machine |
| world-engine.svelte.ts | 177 | `WorldEngine`, `WorldContext`, `WorldPatch`, `MicroEventData`, `AtmospherePatch` | Lightning, weather randomization, micro-events, auto-pilot |
| scenario-data.ts | 172 | `SCENARIOS`, `FlightScenario`, `Waypoint` | 15+ waypoint flight paths for 8 locations |
| flight-scenarios.ts | 83 | `pickScenario()`, `pickNextLocation()` | Weighted random scenario/location selection |
| motion-engine.svelte.ts | 76 | `MotionEngine` | Turbulence, banking, breathing, engine vibe |
| game-loop.ts | 67 | `subscribe()` | RAF singleton with per-subscriber error tracking |
| types.ts | 52 | `SimulationContext`, `ISimulationEngine` | Engine interface contracts |

### engine/cesium/ — Globe Rendering Bridge

| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| cesium-manager.ts | 404 | `CesiumManager`, `CesiumModelView` | Viewer, terrain, buildings, imagery, atmosphere, camera, post-process |
| shaders.ts | 98 | `COLOR_GRADING_GLSL` | GLSL color grading (night lights, dawn/dusk, haze) |
| config.ts | 48 | `getIonToken()`, `initCesiumGlobal()`, `checkLocalTileServer()`, `TILE_SERVER_URL` | Ion token, base URL, tile server health |

### ui/ — Svelte Components

| File | Lines | Context | Purpose |
|------|-------|---------|---------|
| SidePanel.svelte | 691 | useAeroWindow() | Location picker, weather sliders, settings |
| Window.svelte | 590 | useAeroWindow() | Layer compositor, RAF tick, blind drag |
| HUD.svelte | 269 | useAeroWindow() | Altitude/time/weather controls overlay |
| Globe.svelte | 246 | useAeroWindow() | CesiumManager mount/destroy lifecycle |
| CloudBlobs.svelte | 167 | props only | SVG feTurbulence cloud parallax |
| Weather.svelte | 147 | props only | Rain, lightning flash, frost |
| MicroEvent.svelte | 134 | props only | Shooting stars, birds, contrails |
| RangeSlider.svelte | 102 | props only | Reusable slider control |
| Toggle.svelte | 88 | props only | Reusable toggle switch |
| AirlineLoader.svelte | 76 | none | Loading screen |

### services/ — I/O Layer

| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| fleet-admin.svelte.ts | 217 | `AdminStore` | Admin WS/SSE dual-transport, device registry, push commands |
| fleet-client.svelte.ts | 156 | `DisplayWsClient`, `createWsClient()` | Display WS client, auto-connect, status heartbeat |
| persistence.ts | 81 | `loadPersistedState()`, `savePersistedState()`, `PersistedState` | localStorage save/load with validation |
| base-transport.ts | 51 | `BaseTransport`, `TransportState`, `TransportOptions` | Abstract reconnection logic with exponential backoff |

### shared/ — SSOT Leaf

| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| constants.ts | 246 | `AIRCRAFT`, `FLIGHT_FEEL`, `AMBIENT`, `MICRO_EVENTS`, `CESIUM`, `WEATHER_EFFECTS`, `CESIUM_QUALITY_PRESETS` | All tuning constants |
| protocol.ts | 121 | `ServerMessage`, `DisplayMessage`, `ServerAdminMessage`, `FleetClientModel`, `DisplayConfig`, `DeviceInfo`, `DeviceCaps`, `DisplayMode` | Fleet WS protocol types |
| utils.ts | 49 | `clamp()`, `lerp()`, `normalizeHeading()`, `getSkyState()`, `formatTime()` | Math and formatting helpers |
| types.ts | 48 | `SkyState`, `LocationId`, `WeatherType`, `SceneDefaults`, `Location` | Domain type definitions |
| locations.ts | 35 | `LOCATIONS`, `LOCATION_IDS`, `LOCATION_MAP` | 18 cities with lat/lon/scene defaults |
| index.ts | 34 | barrel | Re-exports all shared modules |

### server/ — Fleet Hub

| File | Lines | Purpose |
|------|-------|---------|
| fleet-hub.ts | 207 | Device registry, WS message routing, SSE broadcast, heartbeat |

## src/routes/ — Pages & API

| File | Lines | Purpose |
|------|-------|---------|
| +page.svelte | 252 | Main display — context provider, real-time sync, auto-save, fleet WS |
| +page.ts | 8 | `ssr = false`, `prerender = true` |
| +layout.svelte | 11 | Tailwind import |
| admin/+page.svelte | 855 | Fleet admin dashboard |
| playground/+page.svelte | ~650 | MapLibre globe lab — MotionEngine + CSS3D clouds + NightOverlay |
| architecture/+page.svelte | 1892 | Interactive architecture documentation |
| api/fleet/+server.ts | 56 | Fleet REST endpoints (scene, mode, config push) |
| api/tiles/[...path]/+server.ts | 61 | Tile file proxy with path traversal guard |

## Config Files

| File | Purpose |
|------|---------|
| svelte.config.js | adapter-node, bundleStrategy:'single', CSP directives |
| vite.config.ts | Cesium static copy, 0.0.0.0 host binding, chunk size limit |
| tsconfig.json | Strict mode |
| package.json | bun scripts, cesium dep, svelte 5.50+, three.js (playground only) |
