# Aero 2 Architecture

Minimal, high-performance architecture for the Aero Dynamic Window.

> **MapLibre is the only renderer as of 2026-08-25.** See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. The layer stack

Four product layers, and imports may only point **downward**:

```text
cabin/    🪟 inside the cabin — bezel, glass, blind, HUD
stage/    🌍 outside the window — MapLibre, tiles, terrain, sky
sim/      🎛️ the invisible part — state, flight physics, the frame loop
config/   📐 the shared contract — imports NOTHING
server/   🌐 server-only tile proxy — imports NOTHING
```

`node tools/check-layers.mjs` asserts this, and it runs as part of both
`bun run check` and `bun run test`. It is not decoration: this repo previously
claimed "no import cycles" in prose while `sim/` and `stage/` imported each
other in **both** directions. A rule nothing enforces is a rule nothing keeps.

### Why `config/` exists

`WindowParams` is the contract every layer reads. It used to live in `sim/`,
which also reads everything else — so `sim → stage → sim` and `sim → flight →
sim` were both real cycles. A shared contract cannot live in the layer that
consumes the most; it belongs at the bottom, where nothing can point back down
at it.

`atmosphere.ts` and `imagery.ts` moved there for the same reason. They are pure
data and pure functions that import nothing, so filing them under `stage/`
(which imports `sim/`) made every consumer of a band table transitively depend
on the renderer.

## 2. Directory tree

```text
src/
  ├── lib/
  │   ├── config/                   # 📐 Shared contract — imports nothing
  │   │   ├── window.ts             # WindowParams + every tuning number
  │   │   ├── locations.ts          # Location registry (Hyderabad, Denver)
  │   │   ├── atmosphere.ts         # Bands, altitude blend, night curve
  │   │   └── imagery.ts            # Tile templates, NAIP bounds, zoom caps
  │   │
  │   ├── sim/                      # 🎛️ Simulation, physics & state
  │   │   ├── flight.svelte.ts      # Orbit math, lookTarget, clock, FlightSim
  │   │   ├── window.svelte.ts      # AeroWindow + createAeroWindow/useAeroWindow
  │   │   ├── params.ts             # URL knobs → WindowParams
  │   │   └── game-loop.ts          # requestAnimationFrame driver
  │   │
  │   ├── stage/                    # 🌍 The world outside
  │   │   ├── MapStage.svelte       # MapLibre viewport & camera driver
  │   │   ├── GroundLayers.svelte   # GIBS + USGS + DEM terrain & hillshade
  │   │   └── AtmosphereSky.svelte  # Dynamic sky & atmosphere blend
  │   │
  │   ├── cabin/                    # 🪟 The cabin inside
  │   │   ├── WindowFrame.svelte    # Oval bezel
  │   │   ├── GlassLayer.svelte     # Reflections & vignette
  │   │   ├── CabinBlind.svelte     # Draggable pull-down shade
  │   │   ├── PassengerHud.svelte   # Destination card & telemetry
  │   │   └── DebugReadout.svelte   # Dev-only overlay
  │   │
  │   ├── server/                   # 🌐 Server-only — imports nothing
  │   │   └── tiles.ts              # Path-guarded offline tile server
  │   │
  │   └── assets/favicon.svg
  │
  ├── env.ts                        # SvelteKit 3 environment variables
  │
  └── routes/
      ├── +layout.ts                # `ssr = false` — cascades to every route
      ├── +layout.svelte            # Root layout shell
      ├── +page.ts                  # `load` resolves URL knobs
      ├── +page.svelte              # Composition only
      ├── layout.css                # Global CSS
      └── api/tiles/[...path]/      # Offline tile proxy endpoint
```

## 3. Composition and z-order

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

## 4. Invariants

1. **Layering** — imports point downward only, enforced by `tools/check-layers.mjs`.
2. **Deterministic fleet pose** — wall-clock time is the only input to
   `windowView()`, so three Pis agree without any inter-device protocol. No
   accumulated `dt`, no per-process epoch, no `Math.random()` in the hot path.
3. **Context DI** — `createAeroWindow()` at the root; descendants read
   `useAeroWindow()`. No prop-drilling of simulation state.
4. **Renderer isolation** — only `stage/` and `+page.svelte` import MapLibre.
   `config/` and `sim/` name no renderer at all, which is what made replacing
   Cesium a route-level change rather than a rewrite.
5. **Offline tiles** — everything goes through `/api/tiles`, path-guarded, with
   a local pack preferred. `server/tiles.ts` is the only file naming a real
   upstream origin. Remote proxying fails **closed**.
6. **No renderer maths in components** — a frame callback calls `windowView()`
   and applies the result. Maths in a `.svelte` file cannot be tested without a
   WebGL context.

## 5. Known-sharp edges

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
