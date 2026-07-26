# Repository Guidelines

## Project Overview

Aero Dynamic Window renders a **circadian-aware digital airplane window display** for office wellbeing. It composites CesiumJS globe/terrain/buildings with an optional Three.js photoreal overlay, CSS effect layers, and cabin chrome (oval frame, blind, wing silhouette). Designed for **Raspberry Pi 5 fleet deployment** in headless Chromium kiosk mode. Active branch: `hybrid-v2`.

## Architecture & Data Flow

### Rendering Stack (bottom → top)

```
Cesium globe (terrain, buildings, VIIRS night-lights, post-process color grade)
  └── Three.js overlay (clouds, wing, sky-extras, neon, postprocess) — flag-gated, default OFF
       └── CSS effect layers (haze, artsy clouds, rain, lightning, frost, micro-events)
            └── Shell chrome (oval window frame, blind, glass vignette, HUD)
```

- **Cesium** is confined to `src/lib/world/` — only `CesiumViewer.svelte` does `import('cesium')` at runtime; all other files reference it as a type only.
- **Three.js overlay** (`src/lib/world-three/`) mounts a transparent `<Canvas>` above Cesium. Camera is **pulled** from Cesium each frame (Cesium drives; Three mirrors). Always on at `/playground/three`; on `/` gated behind `config.world.useThreeOverlay` (default `false`, pending P8 Pi-5 perf gate).

### State Management

Single `$state`-based reactive tree:

| File | Role |
|---|---|
| `src/lib/model/aero-window.svelte.ts` | `AeroWindow` class — root simulation state, owns `tick()` loop, orchestrates engines, CRDT config patching, fleet broadcast, persistence |
| `src/lib/model/config-tree.svelte.ts` | Flat reactive config — five `$state` namespaces: `atmosphere`, `camera`, `director`, `world`, `shell`. All tuning numbers live here inline at their defaults. **No `constants.ts` — the config tree IS the SSOT.** |
| `src/lib/model/crdt-store.ts` | CRDT LWW-register store for cross-device config reconciliation |
| `src/lib/model/config-namespaces.ts` | Framework-free SSOT of namespace keys — shared between config-tree and `/api/config` server route allowlist |

Context-based DI: `createAeroWindow()` in `+page.svelte`, `useAeroWindow()` in any descendant.

### Tick Pipeline (60Hz RAF)

```
Pane.svelte (RAF via game-loop.ts)
  └── model.tick(delta)
       ├── flight.tick(delta, ctx)       → FlightPatch (wraps body in untrack())
       ├── motionStep(delta, ctx)        → void        (wraps body in untrack())
       ├── directorTick(delta, ctx)      → WorldPatch  (leader-only, wraps in untrack())
       └── telemetry.recordFrame(duration)
```

Scene effects subscribe to the game-loop independently — NOT driven by `model.tick()`.

### Fleet Protocol (Multi-Pi)

REST + SSE (no central broker). Three Pis form one continuous panoramic window. Leader handles autopilot; followers receive `director_decision` events scheduled at wall-clock instants.

| Endpoint | Purpose |
|---|---|
| `PATCH /api/config` | Config patch dispatch (bearer-gated, namespace-allowlisted) |
| `POST /api/command` | SSE fan-out: `director_decision`, `set_scene`, `set_mode` |
| `POST /api/status` | Device heartbeat |
| `GET /api/devices` | Fleet device registry |
| `GET /api/events` | SSE event stream |

### Flight Mode State Machine

```
orbit ──flyTo()──→ cruise_departure ──(~2s)──→ cruise_transit ──(~2s)──→ orbit
```

## Key Directories

| Directory | Purpose |
|---|---|
| `src/lib/world/` | Cesium globe — terrain, imagery, shaders, VIIRS endpoint. **Cesium runtime import confined here.** |
| `src/lib/world-three/` | Three.js photoreal overlay — clouds, wing, sky-extras, neon, postprocessing. Flag-gated. |
| `src/lib/world-lighting/` | Night-light intensity curves + altitude crossfade — SSOT shared by every city-light layer |
| `src/lib/camera/` | Flight simulation engine (orbit + cruise FSM) + motion module (bank, breathing, turbulence) |
| `src/lib/director/` | Autopilot — weather randomiser + location cycler + night-city flyover beat |
| `src/lib/model/` | Reactive state graph — AeroWindow, config-tree, CRDT store, telemetry, persistence |
| `src/lib/scene/` | Scene composition — effect registry, compositor, z-order SSOT, per-effect folders |
| `src/lib/shell/` | UI surround — Pane, HUD, SidePanel, Blind, Glass, Weather effects |
| `src/lib/fleet/` | Remote Pi fleet management — REST client, SSE, peer sync, heartbeat, mDNS discovery |
| `src/lib/http/` | Shared HTTP helpers — auth, CORS, body parsing, peer token |
| `src/routes/` | SvelteKit routes — `/` (kiosk), `/playground/*` (lab surfaces), `/admin/*` (fleet panel), `/api/*` |
| `content/` | Authored artifacts — locations, weather recipes, palettes, shows. Rule 0: content/control split. |
| `tests/` | Vitest test files mirroring `src/` and `content/` structure |
| `tools/` | Build/deploy tooling — tile packager, OTA push worker, perf harness |
| `docs/` | ADRs, standards, ship readiness, architecture framing |

## Development Commands

| Command | What it does |
|---|---|
| `bun run dev` | Vite dev server (binds `0.0.0.0` for LAN; skips mDNS) |
| `bun run build` | Production build — single-bundle for Pi via `adapter-node` |
| `bun run preview` | Preview production build |
| `bun run check` | Type-check with `svelte-check` |
| `bun run check:watch` | Type-check in watch mode |
| `bun run test` | Run all tests (alias: `bun x vitest run`) |
| `bun x vitest run tests/lib/world-three/sky.test.ts` | Run single test file |
| `bun x vitest run -t "memoises sun"` | Run tests matching a pattern |
| `bun run serve` | Full LAN server via Bun (`server.ts` — starts mDNS peer discovery) |
| `bun run start` | `build` + `serve` (production-like, what the Pi runs) |

`bun run dev` (Vite) skips mDNS — `/api/devices` only shows self. Use `bun run serve` for real fleet discovery.

## Code Conventions & Common Patterns

### Language & Framework

- **Svelte 5** with runes: `$state`, `$derived`, `$effect`, `$bindable()`, `createContext`/`getContext`
- **SvelteKit 2** with SSR disabled (`export const ssr = false` in `+layout.ts`)
- **TypeScript** strict mode — all strict flags enabled, `noUnusedLocals`/`noUnusedParameters`

### State Management

```typescript
// Flat $state, NOT classes per namespace
const config = {
  atmosphere: $state({ clouds: { density: 0.85, speed: 0.6, layerCount: 3 } }),
  camera: $state({ orbit: { driftRate: 0.01 }, parallax: { role: 'solo' } }),
  // ...
};

// Context DI
const model = createAeroWindow();  // only in +page.svelte
const model = useAeroWindow();     // in any descendant
```

### Critical Naming Rule: NEVER name a variable `state` when using `$state`. Use `model`, `engine`, `config`.

### Type SSOT Pattern

Const-array-derived unions for compile-time + runtime validation:
```typescript
export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'overcast', 'storm'] as const;
export type WeatherType = (typeof WEATHER_TYPES)[number];
```

### Effect Pattern

Each scene effect is a self-contained Svelte component:
- Owns its own `$state` — no global mutation
- Receives `{ model, params? }` as its only prop
- Subscribes to game-loop directly via `$effect(() => subscribe(...))`
- Mounts/unmounts via a `when` predicate evaluated against `model.*`
- Registered in `src/lib/scene/registry.ts`; z-index set in `src/lib/scene/layers.ts`

### Geo-Positioned Effects (Cesium-Native)

```typescript
import { activeCesium } from '$lib/world/active.svelte';

$effect(() => {
  const mgr = activeCesium.manager;
  if (!mgr) return;
  const viewer = mgr.getViewer();
  const ds = new Cesium.CustomDataSource('my-effect');
  viewer.dataSources.add(ds);
  return () => viewer.dataSources.remove(ds, true);
});
```

### Architectural Invariants

1. **Cesium isolation** — only `world/CesiumViewer.svelte` does runtime `import('cesium')`
2. **Flat DTO boundary** — config DTOs are flat; extend additively, never nest or reshape
3. **`untrack()` in hot paths** — every tick body wraps work in `untrack(() => ...)`
4. **Deterministic 3-Pi panorama** — use `createSeededRng(daySeed())` from `world-three/prng.ts`, not `Math.random()`
5. **Sun-direction memo aliasing** — `computeSunDirection()` returns a shared mutated array; read-and-derive synchronously, never store the reference
6. **Ship-vs-lab boundary** — `world-three/` changes are lab-only; `compose.ts`, `flight.svelte.ts`, `config-tree.svelte.ts` are shared (affect ship)

### CSS Z-Layer Order

Single source of truth at `src/lib/scene/layers.ts`:
```
z:0   Cesium globe + atmospheric haze
z:1   Clouds (CSS3D sprites)
z:2   Rain + Lightning
z:3   Micro-events
z:5   Frost
z:7   Wing silhouette
z:9   Glass vignette
z:10  Vignette
z:11  Glass recess rim
```

## Important Files

| File | Role |
|---|---|
| `src/lib/model/aero-window.svelte.ts` | Root simulation state — `createAeroWindow()` / `useAeroWindow()` |
| `src/lib/model/config-tree.svelte.ts` | All tunable config — the SSOT for every number |
| `src/lib/model/config-namespaces.ts` | Namespace SSOT shared with server allowlist |
| `src/lib/shell/Pane.svelte` | Layer compositor + RAF tick subscription |
| `src/lib/game-loop.ts` | Single RAF loop — subscriber pattern, visibility-aware |
| `src/lib/scene/registry.ts` | Static effect registry |
| `src/lib/scene/layers.ts` | Z-order SSOT |
| `src/lib/types.ts` | Core domain types — const-array-derived unions, SimulationContext |
| `src/lib/utils.ts` | Shared utilities, `T` time-of-day constants (DAWN_START, DAY_START, etc.) |
| `src/lib/world/compose.ts` | CesiumManager — imports cesium as type |
| `src/lib/world-three/sky.ts` | `computeSunDirection` (memoised, alias contract), environment ambient |
| `src/lib/world-three/prng.ts` | Seeded RNG for 3-Pi determinism |
| `src/lib/world-lighting/curves.ts` | City light intensity curves |
| `src/lib/camera/flight.svelte.ts` | FlightSimEngine — orbit + cruise FSM |
| `src/lib/director/autopilot.svelte.ts` | Weather randomiser + location cycler |
| `src/lib/fleet/client.svelte.ts` | DeviceClient — SSE + REST fleet communication |
| `src/routes/+layout.ts` | SSR disabled app-wide |
| `src/routes/+page.svelte` | Main kiosk display |
| `content/locations/catalog.ts` | Location catalog |
| `content/shows/default.show.ts` | Boot baseline show |
| `server.ts` | Bun server entry — mDNS + adapter-node import |
| `vite.config.ts` | Vite 7 config — SvelteKit, Cesium static copy, vitest inline |
| `svelte.config.js` | SvelteKit config — adapter-node, CSP, `$content` alias, single bundle |
| `package.json` | Dependencies + scripts |
| `tsconfig.json` | Strict TypeScript — extends `.svelte-kit/tsconfig.json` |

## Runtime/Tooling Preferences

- **Runtime**: Bun (lockfile: `bun.lock`). Do NOT use npm, yarn, or pnpm.
- **Build**: Vite 7 + SvelteKit 2 + `@sveltejs/adapter-node` (v5). `bundleStrategy: 'single'` for Pi kiosk.
- **3D stack**: Cesium v1.141, Three.js v0.183, @threlte/core v8, postprocessing v6.
- **Styling**: Tailwind CSS v4 + component-scoped `<style>` blocks.
- **Environment variables** (see `.env.example`):
  - `VITE_CESIUM_ION_TOKEN` — required for terrain/imagery at dev time
  - `TILE_DIR` — offline tile cache (default `/opt/zyeta-aero/tiles` on Pi)
  - `AERO_ADMIN_TOKEN` — bearer auth for admin routes (fail-closed: 503 if unset)
  - `AERO_WIFI_RESET_TOKEN` — bearer auth for WiFi reset (fail-closed)
  - `VITE_PUSH_WORKER_URL` — optional Cloudflare Worker for OTA push
- **CSP**: Locked-down Content-Security-Policy with `unsafe-eval` (required by Cesium protobufjs), `blob:` workers, and connections to all major tile providers.

## Testing & QA

- **Framework**: Vitest 4.x with `happy-dom` environment (configured inline in `vite.config.ts`)
- **Test locations**: `tests/` mirroring `src/` and `content/` structure
- **File patterns**: `**/*.{test,spec}.{ts,svelte.ts}` (includes `.test.svelte.ts` for component tests)
- **No globals**: explicit `import { describe, it, expect } from 'vitest'` required
- **Assertion style**: `expect(value).toBe(expected)` — standard Vitest matchers
- **Server endpoint tests**: Directly import SvelteKit `+server.ts` handler functions, call with synthetic `Request` objects and mock `getClientAddress`
- **No global setup file** — each test file is self-contained
- **Coverage**: 367 tests across 32 files (as of Phase 18). No formal coverage threshold configured.
- **Run**: `bun run test` (alias: `bun x vitest run`)

### Test Patterns

```typescript
// Pure logic test
import { describe, it, expect } from 'vitest';
import { clamp } from '$lib/utils';

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
});

// Svelte module test (.test.svelte.ts)
import { describe, it, expect } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';

describe('AeroWindow', () => {
  it('boots with default config', () => {
    const model = new AeroWindow();
    expect(model.config.camera.parallax.role).toBe('solo');
  });
});

// Server endpoint test
import { GET } from './+server';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('GET /api/internal/peer-token', () => {
  beforeEach(() => { vi.stubEnv('AERO_ADMIN_TOKEN', 'test-token'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('returns token for localhost', async () => {
    const res = await GET(new Request('http://localhost'));
    const json = await res.json();
    expect(json.token).toBe('test-token');
  });
});
```
