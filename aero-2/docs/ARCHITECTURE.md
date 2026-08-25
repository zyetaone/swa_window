# Aero 2 Architecture

Minimal, high-performance architecture for the Aero Dynamic Window.

> **MapLibre is the only renderer as of 2026-08-25.** See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. Folders, and the one rule

Folders name what things **are**, roughly outermost-in:

```text
cabin/    🪟 inside the cabin — bezel, glass, blind, HUD
stage/    🌍 outside the window — MapLibre, tiles, terrain, sky
flight/   🎛️ the invisible part — pose maths, state, the frame loop
domain/   📐 simulation logic that knows no renderer — imports nothing
config/   ⚙️ data: places, tile URLs, zoom caps
server/   🌐 server-only tile proxy
```

There is exactly one enforced rule: **no import cycles**.
`node tools/check-cycles.mjs` runs in both `bun run check` and `bun run test`.
It is not decoration — this repo once claimed "no import cycles" in prose while
the simulation and `stage/` imported each other in **both** directions. A rule
nothing enforces is a rule nothing keeps.

### What this used to be, and why it shrank

This was a five-layer ranking (`domain → server → flight → stage → cabin`) with
a checker that rejected any upward or sibling import. For a 23-file app with one
route, that was more architecture than the code could earn: the ranking was
maintained by hand and forbade many imports that would never have caused harm.

The cycle detector keeps the part that was load-bearing. Cycles are a real
failure — they break tree-shaking and cause undefined-at-import-time bugs that
only surface at runtime. Layer rank was a proxy for that, and the proxy cost
more than the thing it stood in for. If a genuine layering rule is needed again,
it should arrive attached to a bug that proves it.

### Why `domain/` exists

`PaneParams` is the contract every layer reads. It used to live beside the
simulation, which also reads everything else — so `flight → stage → flight` was
a real cycle, in both directions. A shared contract cannot live in the layer
that consumes the most.

`domain/` is deliberately small: `pane.ts` (the contract and its tuning numbers)
and `atmosphere.ts` (band blending and light curves). Both are pure, import
nothing, and would still make sense if MapLibre were replaced tomorrow.

`locations.ts` and `imagery.ts` were in `domain/` and are now `config/`. They are
a list of places and a set of tile URLs — data someone edits, not logic that
models the product. Calling that "domain" made the folder mean two things.

## 2. Directory tree

```text
src/
  ├── lib/
  │   ├── domain/                   # 📐 Renderer-free simulation logic
  │   │   ├── pane.ts               # PaneParams + every tuning number
  │   │   └── atmosphere.ts         # Bands, altitude blend, night curve
  │   │
  │   ├── config/                   # ⚙️ Data someone edits
  │   │   ├── locations.ts          # Location registry (Hyderabad, Denver)
  │   │   └── imagery.ts            # Tile templates, NAIP bounds, zoom caps
  │   │
  │   ├── flight/                   # 🎛️ Simulation, physics & state
  │   │   ├── pose.ts               # Pure: orbit, altitude, lookTarget, clock
  │   │   ├── sim.svelte.ts         # The one reactive class holding the pose
  │   │   ├── aero-window.svelte.ts # AeroWindow + createAeroWindow/useAeroWindow
  │   │   ├── url-params.ts         # URL knobs → PaneParams
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

## 3. Naming rules

Two that are easy to get wrong, and were:

- **`.svelte.ts` means the file holds runes.** `pose.ts` is 220 lines of pure
  trigonometry and is plain `.ts`; only `sim.svelte.ts` has `$state`.
  Putting maths in a `.svelte.ts` advertises reactivity that isn't there, and
  hides the one file that genuinely has it.
- **Never name anything just `window`.** It already means the browser global,
  the cabin window, the `AeroWindow` class and the three-pane wall. One pane is
  a `pane`; the root state object is `aero-window`; the simulation is `flight/`.
  There have been, at different points, two unrelated files called `window` and
  a `window/` folder holding no window code at all.

Files are named for what they hold, not their layer role: `url-params.ts`
parses URLs, `pose.ts` answers where the aircraft is, `sim.svelte.ts` holds it. `tests/` mirrors
`src/lib/` one-for-one.

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
3. **Context DI** — `createAeroWindow()` at the root; descendants read
   `useAeroWindow()`. No prop-drilling of simulation state.
4. **Renderer isolation** — only `stage/` and `+page.svelte` import MapLibre.
   `domain/`, `config/` and `flight/` name no renderer at all, which is what made replacing
   Cesium a route-level change rather than a rewrite.
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
