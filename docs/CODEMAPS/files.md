# File Inventory

**Last Updated:** 2026-08-12

> Per-file line counts drift fast; treat them as ordering hints, not facts.
> Regenerate with `git ls-files src content | xargs wc -l | sort -rn`.

## src/lib/ — Domain library

Organised by domain folder. Shared roots: `types.ts`, `utils.ts`,
`game-loop.ts`, `version.ts`.

### Notable files (by role, not LOC)

| File | Purpose |
|------|---------|
| `model/aero-window.svelte.ts` | AeroWindow + context DI + tick pipeline |
| `model/config-tree.svelte.ts` | Flat `$state` config — SSOT for tuning numbers |
| `model/crdt-store.ts` | LWW timestamp index for fleet config |
| `world/compose.ts` | CesiumManager — terrain, buildings, imagery, post-process |
| `world/CesiumViewer.svelte` | Lone runtime `import('cesium')` site |
| `world/three/ThreeOverlay.svelte` | Flag-gated Three overlay orchestrator |
| `flight/flight.svelte.ts` | FlightSimEngine — orbit + cruise FSM |
| `flight/motion.svelte.ts` | Bank, breathing, turbulence |
| `director/autopilot.svelte.ts` | Weather + location cycler |
| `fleet/client.svelte.ts` | DeviceClient — SSE in, REST out |
| `fleet/peer-sync.svelte.ts` | Admin ambient → fleet PATCH (re-exports `PEER_SYNC_PATHS` from `model/peer-sync-paths.ts`); ambient push-failure log |
| `fleet/parallax.svelte.ts` | Role SSOT — ops/HUD gates, bindings |
| `shell/pane/Pane.svelte` | Layer compositor + RAF tick |
| `shell/operator/SidePanel.svelte` | Operator shell; page composes panel children |
| `shell/operator/panel/patch.ts` | `usePanelConfig` dual-tree write gate |

### By domain

| Domain | Notes |
|--------|-------|
| `model/` | aero-window, config-tree, CRDT, persistence, telemetry |
| `flight/` | orbit + cruise FSM, motion (was `camera/`) |
| `director/` | autopilot, scenarios, show-opening |
| `world/` | Cesium isolation + `three/` overlay subsystems |
| `shell/` | fractal: `pane/` · `passenger/` · `operator/` · `window/` |
| `fleet/` | REST + SSE, peer-sync, parallax roles, mDNS server modules |
| `bundle/` | Content-bundle wire types + disk store (no runtime mount) |
| `http/` | auth, CORS, body parsing, peer token |
| `server/` | LAN peers, SSE bus, tiles-dir, fs-guard |

## src/routes/

| File | Purpose |
|------|---------|
| `+layout.ts` | `ssr = false` (app-wide) |
| `+page.svelte` | Kiosk — root context, SidePanel composition, role init |
| `admin/+page.svelte` | Fleet admin — dual-tree ambient panels + scene push |
| `admin/content/+page.svelte` | Bundle UI (LAN-only) |
| `admin/fleet/health/+page.svelte` | Heartbeat tiles |
| `wiki/+page.svelte` | In-app architecture notes |
| `playground/*` | Lab surfaces |
| `api/config/+server.ts` | Config patch → SSE fan-out |
| `api/events/+server.ts` | SSE stream + replay buffer |
| `api/devices/+server.ts` | Device registry |
| `api/fleet/heartbeat/+server.ts` | Device heartbeats |
| `api/tiles/[...path]/+server.ts` | Tile proxy |
| `api/buildings/[city]/+server.ts` | OSM extrusion GeoJSON |

## content/ — Authored artifacts (Rule 0)

| Path | Purpose |
|------|---------|
| `locations/` | Cities + nature scenes, lat/lon defaults |
| `weather/` | Recipes for 5 weather types |
| `palettes/` | Sky / night colour tables |
| `shows/` | Opening experiences |
