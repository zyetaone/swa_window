# Aero 2 architecture

Minimal rewrite of v1 (`../`). One slice per PR, wall-verified before the next.

> **Renderer under review, less urgently than before.**
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md) proposes replacing
> Cesium with Three + Threlte, gated on a Pi 5 spike. Part of the case was that
> Cesium's imagery path pushed us toward licence-encumbered sources; the
> 2026-08-25 Phase 0 result weakened that half. Everything below describes the
> Cesium path as it stands today. `model.ts` and `rules.ts` are
> renderer-agnostic and survive either outcome — which is exactly why the
> MapLibre probe could be driven by the real motion model rather than a mock.

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
    scene.svelte.ts  aero-window.svelte.ts  config.ts  game-loop.ts
  experience/             what a person actually sees
    CabinWindow.svelte  probe-camera.ts
  server/  assets/

src/routes/
  +page.svelte                    the window (Cesium)
  api/tiles/[...path]/+server.ts  offline tile cache, path-guarded
  lab/maplibre/                   ADR-005 probe — NOT the ship path (§)
```

(§) The probe carries MapLibre; `/` carries Cesium. Verified as separate route
chunks with no shared module, so the kiosk never downloads MapLibre. Deleting
the route and two devDependencies reverts the experiment completely.

`world/terrain/terrarium.ts` is an open elevation decoder
(`(R*256 + G + B/256) - 32768`) over AWS terrarium tiles, so terrain needs no
key and no Ion account.

`experience/probe-camera.ts` converts an eye position + azimuth + depression
into a ground look-target. Pure trig, no renderer — which is why the probe can
share the real motion model instead of approximating it.

| role           | file          | contract                                                                           |
| -------------- | ------------- | ---------------------------------------------------------------------------------- |
| **M**odel      | `model.ts`    | shapes + their canonical values. **Imports nothing.**                              |
| **R**ules      | `rules.ts`    | pure functions over the model. **Never Cesium, never runes.**                      |
| **A**ctions    | `actions.ts`  | applies state to the globe each frame. The **only** files allowed to touch Cesium. |
| e**X**perience | `experience/` | the component a person looks at                                                    |

`.svelte.ts` means the file holds runes. No `index.ts` barrels — every import
names its exact module, which is what keeps the cycle check honest.

## Not an ECS (yet)

There is exactly **one** entity — the Cesium `Viewer`. `RenderFrame` is the
component store flattened to a single row; the `Subsystem[]` in
`window/scene.svelte.ts` is the system list. An entity table would be a `Map`
with one key. Add the entity dimension when props arrive (wing, clouds, sun),
not before.

## Composition

One place, `window/scene.svelte.ts`. `Scene` is mechanism — it walks whatever
list it is given. The list at the bottom of that file is policy: what is in
this world, in the order it is applied. `experience/CabinWindow.svelte` is the
only place the engine adapter meets the scene.

## Data flow

```
window/game-loop  RAF (once scene.opened)
  → aeroWindow.tick()        wall-clock; no dt anywhere
  → aeroWindow.frame()       FlightFrame { camera, timeOfDay }   ← primaries only
  → scene.sync()             derives RenderFrame, walks the subsystems
```

The boundary carries **primaries only**. Atmosphere, imagery and night factor
are derived inside `scene`, once per frame — derived state sent across a
boundary can disagree with its inputs, and on three screens that is a tear.

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

`TerrainSync` picks one of three modes, best first, and never hard-fails:

| mode        | when                               | source                   |
| ----------- | ---------------------------------- | ------------------------ |
| `mesh`      | a `cesium-terrain` pack is on disk | local quantized-mesh     |
| `terrarium` | otherwise, if `navigator.onLine`   | AWS terrarium heightmaps |
| `ellipsoid` | otherwise                          | smooth sphere            |

The fiction survives a flat planet; it does not survive a stack trace.

The probe reaches the same data by a different road: MapLibre decodes terrarium
natively (`encoding="terrarium"`), so the same PNGs drive both the displaced
mesh and the hillshade. One fetch, two uses.

> **Known gap — elevation does not honour Invariant 4.** Imagery goes through
> `/api/tiles`, which fails closed in production. Elevation does not:
> `terrariumTileUrl()` hardcodes `s3.amazonaws.com`, so a kiosk with a working
> LAN fetches heightmaps straight from the internet, pack or no pack. Two
> further wrinkles: `remoteTileUrl()`'s allowlist contains only the three
> sources we rejected on licence (`eox-sentinel2`, `esri-world-imagery`,
> `cartodb-dark`) and neither terrarium nor GIBS; and `navigator.onLine` is
> true on a LAN with no route out, which picks `terrarium` and then fails every
> tile instead of falling back to `ellipsoid`.
>
> Routing terrarium through `/api/tiles/xyz/terrarium/…` closes all three, but
> it is not a free fix: on a Pi with no local pack the honest result is a **flat
> planet**, where today it quietly works by reaching the internet. That is a
> product call — correctness of the offline promise versus visible terrain —
> and it is open.

## Invariants

1. Single Viewer — via the `globe()` attachment only.
2. Cesium isolation — runtime `import('cesium')` in `cesium/` and `actions.ts` files only.
3. Runes live in `.svelte.ts`; `model.ts` and `rules.ts` never hold them.
4. Offline **imagery** — `/api/tiles` first; remote proxy only when `NODE_ENV=development`
   (fails closed on unset, so the Pi never silently reaches the internet); Ion when the cache is empty.
   **Elevation is currently exempt and should not be** — see the known gap above.
5. Fleet determinism — every pose is an absolute function of wall-clock time.
   No per-process epoch, no accumulated `dt`, no `Math.random()` in the hot path.

## Verified mechanically each pass

- no import cycles
- no upward imports across the layering
- `model.ts` imports nothing; `rules.ts` never names Cesium
