# Layered Reorg Plan — April 2026

**Status:** In progress (Phase 0b shipped)
**Source:** council + architect + designer + researcher agents, 2026-04-15
**Owner:** Rick

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
│   ├── state.ts           (was app-state.svelte.ts — WindowModel class)
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
2. **Flat DTO boundary preserved at fleet + persistence.** The config classes live inside `WindowModel` as nested instances (`model.config.atmosphere.clouds.density`), but fleet patches and `localStorage` snapshots still serialize through a flat-key interface for back-compat with v1 protocol. Protocol v2 adds path-targeted patches additively; v1 is never broken.
3. **`tick()` bodies read config via `untrack()`** so 60 Hz reads don't build reactivity dependencies that trigger graph re-evaluation and tank FPS.

## Phase order

Phases 0 and 0b are shipped. Phase order is designed so each ships visible progress without blocking next; code can be committed and PR'd one phase at a time.

| Phase | Deliverable | Files touched | Effort | Status |
|---|---|---|---|---|
| 0a | Svelte 5 `bind:` spike in `/playground` | 1 new file | 30 min | Next |
| 0b | Night-light emissive + bloom | `cesium/shaders.ts`, `cesium/manager.ts`, `constants.ts` | 2 hr | ✅ shipped `e4a9525` |
| 0c | Tile-packager: Ion + Terrarium terrain, Overpass buildings | `tools/tile-packager/src/{sources,index}.ts`, `src/routes/api/buildings/[city]/+server.ts` | 1 day | Pending |
| 1 | `model/config/` skeleton + `$state` classes + `untrack()` wrap in tick bodies | 6 new config files, all engine tick() bodies | 1 day | Pending |
| 2 | `cesium/` → `world/` split with pure-data extraction | 5 files split, ~20 imports updated | 0.5 day | Pending |
| 3 | `simulation/` → `camera/` + `director/` | 5 files moved, class rename | 0.5 day | Pending |
| 4 | Scene effects → `atmosphere/` | 12 files consolidated into 4 folders | 0.5 day | Pending |
| 5 | Chrome extraction + window on/off toggle | `chrome/Frame.svelte` + `chrome/Blind.svelte` new, Window.svelte slimmed | 0.5 day | Pending |
| 6 | Fleet protocol v2 (additive) | `fleet/protocol.ts`, `fleet/client.svelte.ts`, server hub | 1 day | Pending |
| 7 | Multi-Pi parallax (role assignment + lockstep cruise) | `model/config/camera.ts` extension, `director/autopilot.ts` leader election | 1-2 days | Pending |

**Total after Phase 0: ~5 days.**

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
