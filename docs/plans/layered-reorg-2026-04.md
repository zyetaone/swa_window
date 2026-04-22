# Layered Reorg Plan — April 2026

**Status:** ✅ **Complete — all phases 0 through 7 shipped.**
**Source:** council + architect + designer + researcher agents, 2026-04-15
**Owner:** Rick
**Completed:** 2026-04-15

## Fundamental mental model (accepted)

The app is a **map underneath + a virtual camera orbiting above + overlays** — everything else (turbulence, bank, weather, clouds, window chrome) is dressing on that core. The previous `simulation/` + `cesium/` + `scene/` + `ui/` split fragmented decisions that belong together.

## Target tree

```
src/lib/
├── world/              WHAT we see
│   ├── compose.ts         ← the ONE file that imports cesium
│   ├── config.ts
│   ├── shaders.ts
│   ├── active.svelte.ts
│   ├── CesiumViewer.svelte
│   ├── imagery.ts         (pure, extracted)
│   ├── terrain.ts         (pure, extracted)
│   ├── buildings.ts       (pure, extracted)
│   ├── lights.ts          (pure, extracted)
│   └── celestial.ts       (pure, extracted)
├── atmosphere/         BETWEEN camera and world
│   ├── clouds/         (CloudBlobs + scene/effects/clouds merged)
│   ├── weather/        (Weather.svelte rain+frost + lightning merged)
│   ├── micro-events/   (MicroEvent + effects wrapper merged)
│   └── haze.ts         (atmospheric-haze effect folded)
├── camera/             HOW we look
│   ├── orbit.ts           (split from flight.svelte.ts)
│   ├── cruise.ts          (split from flight.svelte.ts)
│   ├── motion.ts          (was simulation/motion)
│   └── index.ts           (CameraEngine facade)
├── director/           WHEN things change
│   ├── autopilot.ts       (was simulation/world.svelte.ts)
│   ├── scenarios.ts
│   └── daylight.ts        (extracted from app-state)
├── chrome/             UI shell
│   ├── Window.svelte      (layer compositor)
│   ├── Frame.svelte       (NEW — oval mask + rivets + vignette)
│   ├── Blind.svelte       (NEW — extracted from use-blind composable)
│   ├── HUD.svelte
│   ├── SidePanel.svelte
│   ├── AirlineLoader.svelte
│   └── controls/
│       ├── Toggle.svelte
│       └── RangeSlider.svelte
├── model/              State + config + persistence
│   ├── state.ts           (was app-state.svelte.ts — AeroWindow class)
│   ├── persistence.ts
│   └── config/
│       ├── world.ts         ($state class)
│       ├── atmosphere.ts    ($state class)
│       ├── camera.ts        ($state class — includes multi-Pi role + offset)
│       ├── director.ts      ($state class)
│       ├── chrome.ts        ($state class — window on/off, blind, HUD visibility)
│       └── index.ts         (root aggregator)
├── scene/              Effect-composition system (unchanged)
│   ├── compositor.svelte
│   ├── registry.ts
│   ├── types.ts
│   ├── bundle/         (runtime-push content system — preserved)
│   └── effects/
│       ├── car-lights/     (geo-positioned, stays)
│       ├── video-bg/       (bundle pattern, stays)
│       └── sprite/         (bundle pattern, stays)
├── fleet/              Remote-control bounded context (protocol v1 + v2)
│   ├── protocol.ts         (v1 + additive v2)
│   ├── transport.svelte.ts
│   ├── client.svelte.ts
│   ├── admin.svelte.ts
│   ├── hub.ts
│   └── url.ts
├── types.ts
├── utils.ts
├── locations.ts
├── validation.ts
└── game-loop.ts
```

## Three rules the reorg must obey

1. **Cesium isolation preserved.** Only `world/compose.ts` imports `cesium`. Every other `world/*.ts` exports pure data/functions that `compose.ts` consumes. This is the single most valuable architectural boundary in the codebase.
2. **Flat DTO boundary preserved at fleet + persistence.** The config classes live inside `AeroWindow` as nested instances (`model.config.atmosphere.clouds.density`), but fleet patches and `localStorage` snapshots still serialize through a flat-key interface for back-compat with v1 protocol. Protocol v2 adds path-targeted patches additively; v1 is never broken.
3. **`tick()` bodies read config via `untrack()`** so 60 Hz reads don't build reactivity dependencies that trigger graph re-evaluation and tank FPS.

## Phase order — all shipped

Each phase shipped with type-check + tests passing. Actual delivery ended up faster than estimated because several phases landed via parallel agent teams.

| Phase | Deliverable | Commit |
|---|---|---|
| 0 | Globe lighting + shadows + reduce-motion scope | `ab61f08` |
| 0a | Svelte 5 `bind:` spike — validated + folded into admin ConfigSandbox | `76e13bd` |
| 0b | Night-light emissive + bloom | `e4a9525` |
| 0c | Tile-packager: Ion + Terrarium terrain, Overpass buildings, `/api/buildings/:city` | `3c603ae` |
| 1 | `model/config/` skeleton — 6 `$state` config classes + `untrack()` wrap | `3d99df8` |
| 2 | `cesium/` → `world/` rename (isolation seam preserved) | `5198544` |
| 3 | `simulation/` → `camera/` + `director/`; `WorldEngine` → `DirectorEngine` | `ca8d3ec` |
| 3.5 | Engines migrated to consume config via `SimulationContext` | `02ffa41` |
| 4 | Scene effects + UI overlays → `atmosphere/` | `f60a550` |
| 5 | `ui/` → `chrome/` + window on/off toggle (CSS visibility approach) | `dc00117` |
| 5.5 | Blind pull hint + route jitter + long-press boost + atmo drift | `333077d` |
| 6 | Fleet protocol v2 (additive) — `config_patch`, `role_assign`, `director_decision` | `1aba65e` |
| 5.7 | Cloudflare Worker firmware-like OTA push | `909ab7c` |
| 7 | Multi-Pi parallax — yaw offset + leader/follower director + `transitionAtMs` | `fea557f` |
| 5.6 | Ring-buffer telemetry + in-window TelemetryPanel (Shift+T) | `5d1dd16` |

**Shipped: 2026-04-15.** 104/104 tests pass, 0 type errors. Config classes renamed to `.svelte.ts` post-ship to match the Svelte 5 rune-module convention.

## Ship-by-ship safety notes

- Every phase passes `bun run check` before commit.
- FPS benchmark after Phase 1 must stay within 5% of baseline (the `$state` config conversion is the only FPS risk).
- Visual diff at Dubai/Mumbai/Himalayas × 4 times-of-day × 3 weather types after Phases 2 and 4 (the two that touch rendering paths).
- Fleet protocol v2 goes in v1-still-works mode — older fleet servers keep functioning.
- Multi-Pi parallax only ships after Phase 6 completes (needs v2 protocol for role assignment).

## Out of scope (explicit deferrals)

- Renaming `model.flight` / `model.world` / `model.motion` fields to match new folder names — mechanical, large-diff, post-reorg commit.
- Replacing all Svelte 4 stores-style patterns with $state — only config classes migrate in this reorg; other state stays.
- Migrating tests — tests use `$lib/...` aliases which auto-resolve; update is purely find-replace.

## Open questions deferred to later

- Whether multi-Pi parallax uses visually-convincing heading yaw (A) or pixel-perfect `PerspectiveOffCenterFrustum` (B). Decision revisited when Phase 7 starts.
- Whether fielded devices support OTA tile delta push or SD card re-image only. Relates to scene/bundle system extension.
