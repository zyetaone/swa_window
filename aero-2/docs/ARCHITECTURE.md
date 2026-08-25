# Aero 2 Architecture

Minimal, high-performance architecture for the Aero Dynamic Window.

> **MapLibre is the only renderer as of 2026-08-25.** See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. Product Co-location and Structure

Following the **Universal Svelte Architecture** principles (_Co-locate first. Extract when there is a reason. Abstract last._), all files that belong to the hardware/kiosk display experience live together inside `src/lib/display/`, while server-only concerns remain isolated in `src/lib/server/`:

```text
display/  🖥️ The complete hardware/kiosk display product slice — visual stage, cabin chrome, flight math, reactive models
server/   🌐 Server-only offline tile proxy
```

There is exactly one enforced rule: **no import cycles**.
`node tools/check-cycles.mjs` runs in both `bun run check` and `bun run test`.
Cycles are the real failure: they break tree-shaking and produce undefined-at-import-time bugs that only surface at runtime.

### Why Co-location

Rather than scattering a ~13-file application across artificial horizontal folders (`domain`, `flight`, `stage`, `cabin`), vertical domain co-location groups things that change together in one place.

- **Visual Components**: `WorldStage.svelte` (outside 3D world: WebGL MapLibre, DEM terrain, satellite & sky), `CabinFrame.svelte` (inside cabin window: oval bezel, depth shadow, glass reflection & vignette)
- **Simulation & Models**: `display.svelte.ts` (reactive `AeroDisplay` state container & `createDisplay`/`useDisplay` Context DI), `flight.ts` (pure flight trajectory, orbit physics, altitude climb, atmosphere blending, night curve)
- **Reactive Configuration SSOT**: `config.svelte.ts` (locations, atmosphere bands, tile templates, tuning constants, reactive `$state` `PaneConfig`, and `readPaneConfig()` URL parser)

## 2. Directory tree

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
  │   │   ├── Display.svelte        # 🪟 Parent component for kiosk window (Stage + Wing + Frame)
  │   │   ├── display.svelte.ts     # 🎛️ Root AeroDisplay model & Context DI (createDisplay / useDisplay)
  │   │   │
  │   │   ├── world/                # 🌍 3D World & Atmosphere (Planet Earth outside)
  │   │   │   ├── Stage.svelte      # WebGL MapLibre viewport & animation loop
  │   │   │   ├── Ground.svelte     # Base satellite & USGS detail imagery
  │   │   │   ├── Relief.svelte     # 3D DEM terrain & hillshading
  │   │   │   ├── Air.svelte        # Dynamic sky, atmosphere & solar lighting blend
  │   │   │   ├── atmosphere.ts     # Atmosphere bands & continuous altitude blending
  │   │   │   └── sun.ts            # Solar clock & day/night lighting factor curve
  │   │   │
  │   │   ├── flight/               # ✈️ Flight Dynamics & Camera Control
  │   │   │   ├── orbit.ts          # Orbital trajectory track, heading & climb/descent curve
  │   │   │   ├── view.ts           # Camera look-at ground target & MapLibre projection
  │   │   │   └── LookControls.svelte # Interactive aiming arrow controls
  │   │   │
  │   │   └── cabin/                # 🪟 Aircraft Cabin Experience
  │   │       ├── Frame.svelte      # Oval window bezel, depth shadow, glass reflection & vignette
  │   │       └── Wing.svelte       # Aircraft wing silhouette with strobe navigation light
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
      ├── +page.svelte              # Declarative root composition with $app/state page.url (<WorldStage />, <CabinFrame />)
      ├── layout.css                # Global CSS
      └── api/tiles/[...path]/      # Offline tile proxy endpoint
```

## 3. Naming rules

- **`.svelte.ts` means the file holds runes.** `config.svelte.ts` and `display.svelte.ts` contain Svelte 5 runes (`$state`); pure math files in `flight/` and `atmosphere/` are plain `.ts`.
- **Single Source of Truth (`config.svelte.ts`)**: All tuning constants, locations, atmosphere bands, tile definitions, and query param parsing live in `config.svelte.ts` with reactive properties bindable to operator panels.
- **Files are named for what they hold.** `WorldStage.svelte` renders the outside world, `CabinFrame.svelte` renders the inside cabin, `flight.ts` computes flight physics, `display.svelte.ts` manages the simulation state. `tests/` mirrors the structure cleanly (`tests/display.test.ts`, `tests/tiles.test.ts`, `tests/regressions.test.ts`).

## 4. Composition and z-order

`+page.svelte` declares the layers in the order a passenger sees them:

```text
MapStage      the world (WebGL canvas)   z 0
GlassLayer    reflections + vignette     z 10
PassengerHud  destination + telemetry    z 15
WindowFrame   the cabin bezel            z 20
CabinBlind    the pull-down shade        z 25
DebugReadout  dev only                   z 50
```

Only `GroundLayers` and `AtmosphereSky` go **inside** `MapStage`, because
`<MapLibre>`'s children slot is for sources and layers. Everything else is DOM
drawn over the canvas and must be a sibling. The HUD was nested inside the map
once; it only looked correct because `position: fixed` escaped the container.

## 5. Invariants

1. **No import cycles** — enforced by `tools/check-cycles.mjs` in `check` and `test`.
2. **Deterministic fleet pose** — wall-clock time is the only input to
   `windowView()`, so three Pis agree without any inter-device protocol. No
   accumulated `dt`, no per-process epoch, no `Math.random()` in the hot path.
3. **Context DI** — `createDisplay()` at the root; descendants read
   `useDisplay()`. No prop-drilling of simulation state.
4. **Renderer isolation** — only `display/WorldStage.svelte` imports MapLibre.
   `config.svelte.ts` and `display/flight.ts` name no renderer at all, which is
   what made replacing Cesium a route-level change rather than a rewrite.
5. **Offline tiles** — everything goes through `/api/tiles`, path-guarded, with
   a local pack preferred. `server/tiles.ts` is the only file naming a real
   upstream origin. Remote proxying fails **closed**.
6. **No renderer maths in components** — a frame callback calls `windowView()`
   and applies the result. Maths in a `.svelte` file cannot be tested without a
   WebGL context.

## 6. Known-sharp edges

- **Tile URL shape is load-bearing.** Templates must be
  `/api/tiles/xyz/{layer}/{z}/{x}/{y}.{ext}`. The route matches that to flip x/y
  into the on-disk WMTS layout. Drop the `xyz/` segment or the extension and
  _every_ tile 404s. This has regressed twice.
- **`raster-opacity: 0` still fetches.** A hidden raster layer keeps requesting
  tiles, so outside NAIP coverage `GroundLayers` **unmounts** the USGS source
  rather than fading it. This once cost 2 143 404s in a single session.
- **`groundDetail`, `deckOpacity` and `nightFactor` are computed but not
  visible.** ADR-005 records them as the parts of the band system MapLibre
  cannot express natively. They are correct and tested; they just do not reach
  the screen yet.
