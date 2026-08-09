# Architecture Codemap

**Last Updated:** 2026-04-26 (phase 11 — post-consolidation)

## Layer diagram

```
                         DEPENDENCY LAYERS

 ┌───────────────────────────────────────────────────────┐
 │  ROUTES                                               │
 │  +layout.ts (ssr=false, app-wide)                    │
 │  +page.svelte — root context + side-effects          │
 │  admin/   playground/   api/                         │
 └─────────────┬───────────────────────┬─────────────────┘
               │                       │
               v                       v
 ┌─────────────────────────┐   ┌──────────────────────────┐
 │  MODEL                  │   │  SHELL                   │
 │  AeroWindow + ctx DI    │   │  Pane (compositor),      │
 │  config tree (SSOT)     │   │  HUD, SidePanel,         │
 │  CRDT LWW store         │   │  panel/* hud/* window/*  │
 │  frame-telemetry        │   └─────────────┬────────────┘
 └────┬─────┬────┬─────────┘                 │
      │     │    │                           │
      v     v    v                           v
 ┌────────┐┌──────────┐ ┌──────────────────────────────┐
 │CAMERA  ││DIRECTOR  │ │ SCENE                        │
 │flight  ││autopilot │ │ SCENE                        │
 │motion  ││scenarios │ │ bundle/* (wire types + store)│
 │        ││          │ │ DOM effects live in shell/   │
 └────────┘└──────────┘ └──────────────┬───────────────┘
                                       │
                                       v
                          ┌──────────────────────────┐
                          │ WORLD                    │
                          │ Cesium isolation         │
                          │ (compose, cesium-setup,  │
                          │ shaders, CesiumViewer)   │
                          └──────────────────────────┘

 Authored content        Boot baseline       Fleet (REST + SSE)
 ┌──────────────┐        ┌────────────┐      ┌──────────────────┐
 │ content/     │        │ show/      │      │ fleet/           │
 │ locations/   │        │ load.ts    │      │ rest-admin       │
 │ weather/     │        │ Show type  │      │ client (SSE)     │
 │ palettes/    │        │ apply...() │      │ peer-sync $eff   │
 │ shows/       │        └────────────┘      │ heartbeat (.svr) │
 └──────────────┘                            │ device-registry  │
                                             │ lan-peers (mDNS) │
                                             │ lan-bundle-cache │
                                             │ parallax (MAC)   │
                                             │ sse-bus (.svr)   │
                                             └──────────────────┘

 Cross-cutting        Shared primitives
 ┌──────────────┐     ┌──────────────────────────┐
 │ night/       │     │ types  utils  game-loop  │
 │ index.ts     │     │ http/cors  http/body     │
 │ (rendering)  │     └──────────────────────────┘
 └──────────────┘
```

## The four invariants

1. **Cesium isolation.** `import 'cesium'` appears in exactly two type-level imports (`world/compose.ts`, `world/cesium-setup.ts`) and one runtime `import('cesium')` (`world/CesiumViewer.svelte`). Verify with `rg "from 'cesium'" src/lib/`.
2. **Flat DTO boundary.** Fleet protocol v1 + v2 messages cross the wire as flat shapes. v2 added `config_patch { path, value }` additively without restructuring v1.
3. **`untrack()` in tick bodies.** Every 60 Hz tick wraps in `untrack()` so reactive dependencies don't propagate across the engine graph: `flight.svelte.ts:88`, `motion.svelte.ts:43`, `autopilot.svelte.ts:31`.
4. **Content/control split (Rule 0).** `content/` holds the authored what-plays artifacts (locations, weather, palettes, shows). `src/lib/` holds the how-it-plays code. Imported via the `$content` alias.

## Data flow: user adjusts a slider

```
SidePanel slider (e.g. AtmosphereControls)
    │  bind:value={config.atmosphere.clouds.density}
    v
config.atmosphere.clouds.density = 0.8        // direct $state mutation
    │
    ├── peer-sync $effect detects change
    │   → POST PATCH /api/config to every peer
    │     (other Pis route through their own CRDT merge)
    │
    ├── ArtsyClouds.svelte $derived recomputes sprite count
    │
    └── Pane.svelte $derived recomputes filterString
        → CSS backdrop-filter on the window pane
```

## Data flow: RAF tick

```
game-loop.ts (RAF singleton)
    │  subscribe(fn)
    v
Pane.svelte $effect → model.tick(delta)
    │
    ├── flight.tick(delta, ctx)            untrack() → FlightPatch
    │     (orbit, scenarios, cruise FSM)
    │
    ├── motionStep(delta, ctx)             untrack() → void
    │     (turbulence, banking, breathing, vibe)
    │
    └── directorTick(delta, ctx)           untrack() → WorldPatch
          early-return if !ctx.isLeader
          ├── tickRandomize → AtmospherePatch
          └── tickDirector  → LocationId
                    │
                    └── if leader: emit director_decision
                        with transitionAtMs = now + 2.5 s
                        → followers schedule timeout to apply at wall-clock
```

CesiumManager has its own `postRender` tick — decoupled from `game-loop.ts`.

## Data flow: fleet config write

```
Admin slider (or peer device's local UI)
    │
    v
config.atmosphere.haze.amount = 0.12
    │
    ├── crdt.set(path, value, Date.now(), deviceId)
    │     (local LWW timestamp + sourceId)
    │
    ├── peer-sync $effect → POST /api/config
    │   {path, value, timestamp, sourceId}
    │
    v
Peer device's POST /api/config handler
    │
    v
applyConfigPatch(path, value, {timestamp, sourceId})
    │
    └── crdt.merge(...)
          ├── if local timestamp newer → reject (return false)
          ├── if equal & local sourceId greater → reject
          └── else apply → setByPath() → reactive update
```

LWW with sourceId tiebreak guarantees deterministic convergence across peers without central coordination.

## Component tree

```
+page.svelte ── CONTEXT BOUNDARY (createAeroWindow)
│
├── Pane.svelte ── useAeroWindow(), game-loop subscription
│   ├── CesiumViewer.svelte ── runtime import('cesium')
│   ├── GlobeLayer.svelte ── hosts CesiumViewer
│   ├── window/RainGlass (CSS water beads, mounted only while raining)
│   ├── window/Glass (vignette + recess)
│   └── window/Blind ── useBlind composable
│
├── HUD.svelte ── useAeroWindow() + showsOpenPassengerHud (parallax SSOT)
├── SidePanel.svelte ── showsOpsChrome + isOpsModeParam (parallax SSOT)
│   ├── hud/TelemetryOverlay (open-state, ALT/GS/LOC)
│   └── hud/BlindInfoCard (closed-state branding)
│
├── SidePanel.svelte ── useAeroWindow()
│   └── panel/* (LocationPicker, TimeControl, FlightControls,
│       AtmosphereControls, LightingControls, WeatherPicker)
│
└── TelemetryPanel.svelte ── Shift+T devtools view
```

## State ownership

| Owner | Responsibility |
|-------|----------------|
| `model/aero-window.svelte.ts` | AeroWindow class — composes engines, owns `location`/`weather`/`timeOfDay`/`flightMode`, dispatches ticks, applies show opening, holds `flight` instance, telemetry |
| `model/config-tree.svelte.ts` | Flat `$state` namespaces: `atmosphere`, `camera`, `director`, `world`, `shell`. The default literals here are the SSOT for tuning — no `constants.ts`. |
| `model/crdt-store.ts` | LWW register store with sourceId tiebreak. Wraps the config tree so fleet peers reach deterministic convergence. |
| `camera/flight.svelte.ts` | FlightSimEngine class — orbit + cruise FSM. Mutable position state, exposed via `model.flight.*`. |
| `camera/motion.svelte.ts` | Module-scope `motion` `$state` — turbulence, banking, breathing, vibe. Singleton; no class. |
| `director/autopilot.svelte.ts` | Module-scope private timers. `directorTick()` returns `WorldPatch`. Leader-only. |
| `scene/bundle/store.svelte.ts` | Reactive bundleStore — installed pushable bundles (sprites, video-bg). |
| `fleet/rest-admin.svelte.ts` | RestAdminStore class — admin dashboard state (devices, connectionState). |
| `fleet/client.svelte.ts` | DeviceClient class — SSE event source + status loop. |
| `fleet/parallax.svelte.ts` | Role bindings + chrome gates (`isEdgePane`, `showsOpsChrome`, `showsOpenPassengerHud`). |
| `fleet/heartbeat.svelte.ts` (`.server`) | Per-device ring buffer of heartbeat samples (server-side). |
| `fleet/device-registry.server.ts` | Per-device live status (online + lastSeen). |

## Key interfaces

### `SimulationContext` (`src/lib/types.ts`)
The per-frame snapshot every engine tick receives. Carries `time`, `delta`, `heading`, `altitude`, `weather`, `turbulenceLevel`, plus full `camera` + `director` config slices, plus `isLeader`. Pre-allocated; reused each frame.

### Scene effects (no registry)
The `Effect`/`Compositor` registry was removed. DOM effects are plain Svelte
components composed directly in `shell/Pane.svelte` and mounted with `{#if}`.
Geo effects render inside Cesium via manager classes in `world/`.

### `Show` (`src/lib/show/load.ts`)
The authored experience primitive. Today carries an `opening: { location, weather, timeOfDay }`. Documented growth surface: `scenes`, `cues`, `rotation`, `palette`.

### Fleet protocol v1/v2 (`src/lib/fleet/protocol.ts`)
v1 = flat patches. v2 = path-targeted (`config_patch`, `role_assign`, `director_decision`). Coexist on the wire; receivers branch on the `v` field.

## Flight mode FSM

```
orbit ─────flyTo()─────▶ cruise_departure ───(~2s)──▶ cruise_transit ───(~2s)──▶ orbit
                          warp ramp                    teleport + arrive
                          blind closes                 blind opens

durations: model.config.camera.cruise.{departureDurationSec, transitDurationSec}
```

## Z-layer system

There is no shared Z table. Layer order is local CSS in `shell/Pane.svelte`
(Cesium render-layer at `z-index: 0`, then `RainGlass`, `Glass`, `Blind`).
