# Aero 2 Architecture

Minimal, high-performance architecture for the Aero Dynamic Window.

> **MapLibre is the canonical renderer as of 2026-08-25.** See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. Symmetrical Feature-Slice Architecture

Following the **Universal Svelte Architecture** principles (_Co-locate first. Encapsulate features. Abstract last._), the application is organized into two symmetrical feature slices inside `src/lib/`, with server-only tile streaming isolated in `src/lib/server/`:

```text
settings/ ⚙️ Settings, Config SSOT & Operator/Admin Drawers (<Settings />, settings.svelte.ts, locations.ts, tiles.ts)
display/  🖥️ Kiosk Display Window (<Display />, <Stage />, <Wing />, <Frame />, display.svelte.ts, world/, flight/, cabin/)
server/   🌐 Server-only offline tile proxy (tiles.ts)
```

There is exactly one enforced structural rule: **no import cycles**.
`node tools/check-cycles.mjs` runs in both `bun run check` and `bun run test`. Cycles are the real failure: they break tree-shaking and produce undefined-at-import-time bugs.

---

## 2. Directory Tree

```text
src/
  ├── lib/
  │   ├── settings/                 # ⚙️ Settings Slice
  │   │   ├── Settings.svelte       # 🎛️ Drawer UI (tuning & admin snippets, shared glass styles)
  │   │   ├── settings.svelte.ts    # Reactive PaneSettings model ($state), locations, tiles & parser
  │   │   ├── locations.ts          # Location catalog (Hyderabad, Denver)
  │   │   └── tiles.ts              # Tile endpoints, NAIP coverage, hillshade defaults
  │   │
  │   ├── display/                  # 🖥️ Hardware/Kiosk Display product slice
  │   │   ├── Display.svelte        # 🪟 Parent component for kiosk window (Stage + Wing + Frame + MiniMap + Hud)
  │   │   ├── display.svelte.ts     # 🎛️ Root AeroDisplay model & Context DI (createDisplay / useDisplay)
  │   │   │
  │   │   ├── world/                # 🌍 3D World & Atmosphere (Planet Earth outside)
  │   │   │   ├── Stage.svelte      # WebGL MapLibre viewport & animation loop (<svelte:boundary>)
  │   │   │   ├── Ground.svelte     # Base satellite & USGS detail imagery
  │   │   │   ├── Relief.svelte     # 3D DEM terrain & hillshading
  │   │   │   ├── Air.svelte        # Dynamic sky, atmosphere & solar lighting blend
  │   │   │   ├── atmosphere.ts     # Atmosphere bands & continuous altitude blending
  │   │   │   └── sun.ts            # Solar clock & day/night lighting factor curve
  │   │   │
  │   │   ├── flight/               # ✈️ Flight Dynamics & Camera Control
  │   │   │   ├── orbit.ts          # Orbital trajectory track, heading & climb/descent curve
  │   │   │   ├── view.ts           # Camera look-at ground target & MapLibre projection
  │   │   │   ├── MiniMap.svelte    # Top-down orbit minimap inset
  │   │   │   └── LookControls.svelte # Interactive aiming arrow controls
  │   │   │
  │   │   └── cabin/                # 🪟 Aircraft Cabin Experience
  │   │       ├── Frame.svelte      # Oval window bezel, depth shadow, glass reflection & vignette
  │   │       ├── Wing.svelte       # Aircraft wing silhouette with strobe navigation light
  │   │       └── Hud.svelte        # Live FPS, telemetry gauges (altitude, bank, time) & attribution band
  │   │
  │   ├── server/                   # 🌐 Server-only tile proxy (imports nothing)
  │   │   └── tiles.ts              # Path-guarded offline tile server
  │   │
  │   └── assets/
  │       └── favicon.svg
  │
  ├── env.ts                        # SvelteKit environment variables
  │
  └── routes/
      ├── +layout.ts                # `ssr = false` — cascades to every route
      ├── +layout.svelte            # Root layout shell
      ├── +page.svelte              # Declarative root composition (<Display><Settings /></Display>)
      ├── layout.css                # Global design tokens & frosted glass CSS variables
      └── api/tiles/[...path]/
          └── +server.ts            # Offline tile proxy endpoint (206 Partial Content)
```

---

## 3. Symmetrical Naming Rules

- **`.svelte.ts` means the file holds runes.** `settings.svelte.ts` and `display.svelte.ts` contain Svelte 5 runes (`$state`); pure math files in `flight/` and `world/` are plain `.ts`.
- **Top-Level Feature Components:** Every feature slice provides a parent component (`Display.svelte`, `Settings.svelte`) that encapsulates its internal sub-components.
- **Single Source of Truth (`settings.svelte.ts`)**: All live tuning knobs, locations, atmosphere bands, tile definitions, and query param parsing originate here.
- **Canonical Nomenclature (No Folder Stuttering)**: `world/Stage.svelte` (not `WorldStage`), `cabin/Frame.svelte` (not `CabinFrame`).

---

## 4. Layer Composition and Z-Order

In `Display.svelte` and `+page.svelte`, layers are composed strictly in physical passenger perspective:

```text
Layer                  Role                                    Z-Index
──────────────────────────────────────────────────────────────────────
Stage (MapLibre)       Outside 3D world (terrain, sky, sun)    0 (inside <svelte:boundary>)
Wing                   Aircraft wing silhouette & strobe light 5
Frame                  Cabin oval bezel, glass & vignette      10
Settings (Drawers)     Operator tuning & admin diagnostics    100 (injected via children slot)
```

---

## 5. Architectural Invariants

1. **No import cycles** — enforced by `tools/check-cycles.mjs` in `check` and `test` across all 24 modules.
2. **Deterministic fleet pose** — wall-clock time is the only input to `calculateCameraView()`, so multiple Pis agree without an inter-device protocol. No accumulated `dt`, no per-process epoch drift, no `Math.random()`.
3. **Context DI** — `createDisplay()` at the root; descendants read `useDisplay()`. Zero prop-drilling.
4. **Renderer isolation** — only `display/world/` imports MapLibre. `settings/` and `flight/` name no renderer at all.
5. **Offline tiles** — everything flows through `/api/tiles`, path-guarded, with local PMTiles preferred. `server/tiles.ts` is the only file naming upstream origins.
6. **Error resilience with `<svelte:boundary>`** — WebGL context loss or shader errors in `<Stage />` are caught by the error boundary, keeping the cabin frame and operator controls alive.
7. **No barrel files (`index.ts`)** — direct, explicit, tree-shakeable imports across all slices.

---

## 6. Known-Sharp Edges

- **Tile URL shape is load-bearing.** Templates must be `/api/tiles/xyz/{layer}/{z}/{x}/{y}.{ext}`.
- **`raster-opacity: 0` still fetches.** Outside NAIP coverage, `Ground.svelte` **unmounts** the USGS source (`{#if config.detail > 0}`) rather than fading it, preventing hundreds of 404 tile requests.
