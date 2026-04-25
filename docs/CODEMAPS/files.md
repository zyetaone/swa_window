# File Inventory

**Last Updated:** 2026-04-26
**Totals:** `src/lib/` 78 files / 9,183 lines · `src/routes/` 22 / 2,782 · `content/` 8 / 316

## src/lib/ — Domain library

The library is organised by domain folder. Each domain owns its own
state, logic, and (where relevant) Svelte components. There are 4 shared
files at the root: `types.ts`, `utils.ts`, `game-loop.ts`, plus
`night/index.ts` (a deliberate cross-cutting barrel for night rendering).

### Top-15 files by size

| LOC | File | Purpose |
|----:|------|---------|
| 618 | `world/compose.ts` | CesiumManager: terrain, buildings, imagery, atmosphere, post-process. Cesium isolation lives here. |
| 457 | `shell/SidePanel.svelte` | Composes `panel/*` sections — most lines are CSS. |
| 443 | `model/aero-window.svelte.ts` | AeroWindow class + context DI + tick pipeline. |
| 361 | `shell/Window.svelte` | Layer compositor + RAF tick + window-frame toggle. |
| 349 | `model/config-tree.svelte.ts` | Flat `$state` config — SSOT for every tuning number. |
| 336 | `scene/effects/clouds/ArtsyClouds.svelte` | CSS3D cloud sprite renderer. |
| 294 | `fleet/client.svelte.ts` | DeviceClient — SSE in, REST POST out. |
| 265 | `shell/TelemetryPanel.svelte` | Ring-buffer viewer (Shift+T). |
| 260 | `world/CesiumViewer.svelte` | Lone runtime `import('cesium')` site. |
| 254 | `fleet/rest-admin.svelte.ts` | RestAdminStore — admin dashboard. |
| 248 | `camera/flight.svelte.ts` | FlightSimEngine — orbit + cruise FSM. |
| 198 | `shell/use-blind.svelte.ts` | Drag/snap composable. |
| 173 | `fleet/lan-bundle-cache.server.ts` | 4-tier offline-Pi bundle ladder. |
| 169 | `shell/window/Blind.svelte` | Pull-down shade widget. |
| 168 | `fleet/parallax.svelte.ts` | MAC-fingerprint role bindings. |

### By domain

| Domain | Files | Notes |
|--------|------:|-------|
| `model/` | 5 | aero-window, config-tree (SSOT), CRDT, persistence, frame-telemetry |
| `fleet/` | 10 | REST + SSE; no central broker. Includes server modules (`*.server.ts`). |
| `scene/` | ~25 | compositor, registry, layers (Z SSOT), 7 effects under `effects/`, bundle subsystem |
| `shell/` | ~18 | Window, HUD, SidePanel, panel/* (6 controls), hud/*, window/* |
| `world/` | 6 | Cesium isolation — compose, cesium-setup, shaders, CesiumViewer, active |
| `camera/` | 2 | flight + motion |
| `director/` | 2 | autopilot + scenarios |
| `show/` | 1 | Show type + applyShowOpening |
| `night/` | 1 | Cross-cutting barrel for the night rendering pipeline |
| `http/` | 2 | cors + body (size-limited reads) |
| root | 4 | types, utils, game-loop |

## src/routes/

| File | Purpose |
|------|---------|
| `+layout.ts` | `ssr = false` (app-wide; descendants inherit) |
| `+page.svelte` | Main display — root context + side-effects + role init |
| `+page.ts` | `prerender = true` (root only) |
| `admin/+page.svelte` | Fleet admin dashboard |
| `admin/content/+page.svelte` | Drag-drop bundle UI (LAN-only) |
| `admin/fleet/health/+page.svelte` | Heartbeat tile dashboard |
| `playground/+page.svelte` | Lean Cesium scene lab |
| `api/fleet/+server.ts` | Fleet REST surface (scene/mode/config push) |
| `api/fleet/heartbeat/+server.ts` | POST heartbeats from devices; GET rollups |
| `api/devices/+server.ts` | Device registry + announce |
| `api/config/+server.ts` | Config patch endpoint |
| `api/events/+server.ts` | SSE pub/sub stream |
| `api/content/+server.ts` + `[id]/+server.ts` | Bundle CRUD + delete |
| `api/assets/+server.ts` + `[filename]/+server.ts` | Asset upload + serve |
| `api/bundle/[hash]/+server.ts` | LAN peer-cache bundle blob |
| `api/buildings/[city]/+server.ts` | OSM extrusion GeoJSON |
| `api/tiles/[...path]/+server.ts` | Tile proxy with path-traversal guard |

## content/ — Authored artifacts (Rule 0 split)

| File | Purpose |
|------|---------|
| `locations/catalog.ts` | 18 cities with lat/lon/scene defaults |
| `locations/index.ts` | Barrel — Location, SceneDefaults types |
| `weather/recipes.ts` | WEATHER_EFFECTS for 5 weather types |
| `palettes/sky.ts` | Per-skyState background gradient + haze color |
| `palettes/car-lights.ts` | RGBA tuples per light class (white/red/blue) |
| `shows/default.show.ts` | Default Show — opening location/weather/timeOfDay |

Imported via the `$content` alias (svelte.config.js).

## Config

| File | Purpose |
|------|---------|
| `svelte.config.js` | adapter-node, `bundleStrategy: 'single'`, CSP, `$content` alias |
| `vite.config.ts` | Cesium static copy, 0.0.0.0 host binding |
| `tsconfig.json` | strict mode |
| `package.json` | bun scripts, cesium dep, svelte 5.50+ |
