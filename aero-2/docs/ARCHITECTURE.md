# Aero 2 architecture

Minimal rewrite of v1 (`../`). One slice per PR, wall-verified before the next.

> **MapLibre is the window as of 2026-08-25.** The ADR-005 probe was promoted
> from `/lab/maplibre` to `/`, and Cesium was removed from routing entirely —
> no `/lab/cesium`, no fallback route. This is a dev-time bet on look and
> licence — **the Pi 5 side-by-side (ADR-005 Phase 1) has not run**, so it is
> not a measured performance verdict, and there is currently no route to fall
> back to if it goes the other way. `cesium/`, `window/scene.svelte.ts`,
> `window/aero-window.svelte.ts` and `experience/CabinWindow.svelte` are
> unreferenced by any route as of this change — real code, not yet deleted,
> with nothing routing to it. `model.ts` and `rules.ts` are renderer-agnostic
> and untouched by any of this. See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## Shape

Folders are **nouns from the product**. Files are **MRAX roles**, and the same
four words mean the same four things in every folder.

```
src/lib/
  world/                  what you see out of the window
    locations.ts            the worlds we fly over
    atmosphere/  model.ts  rules.ts  actions.ts
    imagery/     model.ts  rules.ts  actions.svelte.ts
    terrain/     model.ts  rules.ts  actions.ts  terrarium.ts
    lighting/              rules.ts  actions.ts
  flight/                 where the window looks, and when
    model.ts  rules.ts  actions.ts  engine.svelte.ts  clock.ts
  cesium/                 the engine, quarantined
    types.ts  attach.svelte.ts  tiles.svelte.ts  gate.ts
  window/                 composition
    scene.svelte.ts  aero-window.svelte.ts  config.ts  game-loop.ts   (§)
  experience/             what a person actually sees
    CabinWindow.svelte  probe-camera.ts
  server/  assets/

src/routes/
  +page.svelte                    the window (MapLibre)
  api/tiles/[...path]/+server.ts  offline tile cache, path-guarded
```

(§) `scene.svelte.ts`, `aero-window.svelte.ts`, `cesium/` and
`experience/CabinWindow.svelte` are the Cesium wiring. Nothing routes to them
as of 2026-08-25 — `/lab/cesium` was created, then removed on instruction
rather than kept as a fallback. `model.ts`/`rules.ts` back both this dead path
and the live MapLibre one identically, which is why nothing here needed to
change when the route did. Delete this code, or wire a route back to it —
both are one-file decisions, not a rewrite, because the split was already
clean.

`world/terrain/terrarium.ts` is an open elevation decoder
(`(R*256 + G + B/256) - 32768`) over AWS terrarium tiles, so terrain needs no
key and no Ion account.

`experience/probe-camera.ts` converts an eye position + azimuth + depression
into a ground look-target. Pure trig, no renderer — which is why `/` can share
the real motion model instead of approximating it.

| role           | file          | contract                                                                           |
| -------------- | ------------- | ---------------------------------------------------------------------------------- |
| **M**odel      | `model.ts`    | shapes + their canonical values. **Imports nothing.**                              |
| **R**ules      | `rules.ts`    | pure functions over the model. **Never Cesium, never runes.**                      |
| **A**ctions    | `actions.ts`  | applies state to the globe each frame. The **only** files allowed to touch Cesium. |
| e**X**perience | `experience/` | the component a person looks at                                                    |

`.svelte.ts` means the file holds runes. No `index.ts` barrels — every import
names its exact module, which is what keeps the cycle check honest.

## Not an ECS (yet)

True of the (currently unreferenced) Cesium path: exactly **one** entity, the
`Viewer`. `RenderFrame` is the component store flattened to a single row; the
`Subsystem[]` in `window/scene.svelte.ts` is the system list. An entity table
would be a `Map` with one key. Add the entity dimension when props arrive
(wing, clouds, sun), not before — and not on the MapLibre path unless it grows
a reason to.

## Composition

`/` does not go through a `Scene`. MapLibre's declarative sources/layers
(`RasterTileSource`, `Terrain`, `HillshadeLayer`, `Sky`) are the composition,
written directly in `+page.svelte`: `resolveAtmosphere`/`nightLighting` are
called and their output handed straight to component props. That works
because MapLibre's own reactive prop layer does the job a `Scene` exists to do
for an imperative API. If this route grows past a handful of layers, that is
the signal to give it its own composition point.

The unreferenced Cesium path composes differently, worth keeping in mind if it
is ever reconnected: one place, `window/scene.svelte.ts`. `Scene` is
mechanism — it walks whatever list it is given; the list at the bottom of
that file is policy. `experience/CabinWindow.svelte` was the only place the
engine adapter met the scene.

## Data flow

```
window/game-loop  RAF
  → orbitPose(wallT) / altitudeAt(wallT)   primaries, computed directly
  → resolveAtmosphere / nightLighting      derived with $derived
  → map.jumpTo(...) + reactive layer props
```

No `FlightFrame`/`RenderFrame` boundary object on this path — there is one
consumer, so nothing is serialized across a layer to disagree with its
inputs. Introduce one if a second consumer appears.

The unreferenced Cesium path used an explicit boundary instead, because it had
two things to keep honest across: `aeroWindow.tick()` → `frame()` returned a
`FlightFrame` carrying **primaries only**; `scene.sync()` derived
`RenderFrame` from it once per frame. Derived state sent across a boundary can
disagree with its inputs, and on three screens that is a tear — the reason for
the extra object, and why it is worth re-reading if this path is reconnected.

## What the ground is made of

Settled 2026-08-25, and it is the reason the licence constraint stopped
blocking. See [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

| layer     | source                | licence       | resolution  |
| --------- | --------------------- | ------------- | ----------- |
| elevation | AWS terrarium         | open data     | z13, ~19 m  |
| base      | NASA GIBS MODIS       | public domain | z9, ~306 m  |
| detail    | USGS NAIP             | public domain | z16, ~2.4 m |
| shading   | hillshade off the DEM | —             | free        |

NAIP is **US-only**. Everywhere else, including Hyderabad, falls back to the
306 m GIBS floor. That was expected to look unacceptable and does not, because
**the eye reads structure as sharpness, not pixel count.** Hillshade derived
from elevation already on hand closed a gap that ~55x more imagery resolution
was supposed to be needed for.

The practical consequence: reach for shading, contrast and linework before
reaching for a bigger texture. Esri, EOX s2cloudless and CARTO were all
rejected on licence, and all three were solving a problem this stack does not
have.

### Heightmaps

Elevation is a **heightmap**, not a mesh pack. `terrain/terrarium.ts` decodes
terrarium PNGs to a `Float32Array` and hands them to Cesium's own
`HeightmapTerrainData`, so Cesium owns the tiling scheme and all the meshing —
there is nothing of ours in the geometry to get subtly wrong.

The unreferenced Cesium path's `TerrainSync` picked one of three modes, best
first, and never hard-failed:

| mode        | when                                       | source                   |
| ----------- | ------------------------------------------ | ------------------------ |
| `mesh`      | a `cesium-terrain` pack is on disk         | local quantized-mesh     |
| `terrarium` | otherwise, if the tile server can serve it | AWS terrarium heightmaps |
| `ellipsoid` | otherwise                                  | smooth sphere            |

The fiction survives a flat planet; it does not survive a stack trace.

On `/`, MapLibre decodes the same terrarium PNGs natively
(`encoding="terrarium"`) with no fallback ladder — a `RasterDEMTileSource`
either has data or the tile is missing. The win is that one fetch drives two
uses: the displaced terrain mesh and the hillshade.

Elevation goes through `/api/tiles` like everything else, so a local pack is
used when one exists and the deployment decides whether misses may be proxied.
`remoteTileUrl()` is the single place that answers "can this kiosk reach the
internet, and for what" — terrarium is on that allowlist; nothing else needs to
be for the ground to work.

Mode selection asks the tile server, via `/health`, rather than
`navigator.onLine` — which reports true on a LAN with no route out, picked
`terrarium`, and then failed every tile instead of falling back cleanly.

> **Still open:** with no local pack and no `AERO_TILE_REMOTE_FALLBACK=1`, a
> production kiosk gets `ellipsoid` — a flat planet. That is now an explicit
> deploy choice rather than a hidden internet dependency, but the real fix is
> shipping a terrarium pack so neither is needed.

## Invariants

1. Single Viewer — `/` holds a single `maplibregl.Map`, captured once via
   `bind:map`. (The unreferenced Cesium path held its `Viewer` the same way,
   via the `globe()` attachment.)
2. Cesium isolation — runtime `import('cesium')` in `cesium/` and `actions.ts` files only.
   `model.ts`/`rules.ts` import neither Cesium nor MapLibre; `/` imports MapLibre only.
3. Runes live in `.svelte.ts`; `model.ts` and `rules.ts` never hold them.
4. Offline tiles — `/api/tiles` first, **imagery and elevation alike**; remote proxy only when
   `NODE_ENV=development` or `AERO_TILE_REMOTE_FALLBACK=1` (fails closed on unset, so the Pi never
   silently reaches the internet); Ion when the cache is empty. Every reachable remote origin is
   listed in `remoteTileUrl()` and nowhere else.
5. Fleet determinism — every pose is an absolute function of wall-clock time.
   No per-process epoch, no accumulated `dt`, no `Math.random()` in the hot path.

## Verified mechanically each pass

- no import cycles
- no upward imports across the layering
- `model.ts` imports nothing; `rules.ts` never names Cesium
