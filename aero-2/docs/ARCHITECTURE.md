# Aero 2 architecture

Minimal rewrite of v1 (`../`). One slice per PR, wall-verified before the next.

> **MapLibre is the only renderer as of 2026-08-25.** The ADR-005 probe was
> promoted from `/lab/maplibre` to `/`, and Cesium was then deleted outright —
> the `cesium/` folder, `window/scene.svelte.ts`, `window/aero-window.svelte.ts`,
> `experience/CabinWindow.svelte`, the per-subsystem `actions.ts` files, the
> `cesium` dependency and its 8.9 MB of `static/cesiumStatic` runtime assets.
> There is no fallback route and no second engine.
>
> This is a dev-time bet on look and licence: **the Pi 5 side-by-side (ADR-005
> Phase 1) has not run**, so it is not a measured performance verdict. Deleting
> rather than parking the old path was deliberate — an unrouted engine still
> costs review, CSP surface, build time and install weight, and git remembers it
> either way. If Phase 1 goes badly the answer is `git revert`, not a folder
> kept warm. `model.ts` and `rules.ts` were always renderer-agnostic, which is
> why none of them changed. See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## Shape

Folders are **nouns from the product**. Files are **MRAX roles**, and the same
four words mean the same four things in every folder.

```
src/lib/
  world/                    what you see out of the window
    locations.ts              the worlds we fly over
    atmosphere/  model.ts  rules.ts
    imagery/     tiles.ts     tile templates + NAIP coverage
    lighting/    rules.ts
  flight/                   where the window is, and when
    model.ts  rules.ts  clock.ts  look-target.ts
    view.ts                   the whole aircraft state for one instant
  window/                   knobs and the frame source
    config.ts  params.ts  game-loop.ts
  components/               what a person actually sees
    GroundLayers.svelte  AtmosphereSky.svelte  DebugReadout.svelte
  server/  assets/

src/env.ts                        declared environment variables (SvelteKit 3)

src/routes/
  +layout.ts                      `ssr = false` — cascades to every route
  +page.ts                        `load` resolves the URL knobs
  +page.svelte                    the window — map handle + frame loop only
  api/tiles/[...path]/+server.ts  offline tile cache, path-guarded
```

### SvelteKit 3 conventions used here

This app targets SvelteKit 3, which moved several things. None of the following
is a local invention, and none of it should be "corrected" back:

| Convention                         | Why it looks unusual                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#lib/foo.js`, not `$lib/foo`      | `$lib` was removed. `#lib` is a Node subpath import declared in `package.json`, resolved natively by Vite and TypeScript. Extensions are **required** — subpath imports must be unambiguous.                            |
| No `svelte.config.js`              | Config moved into the `sveltekit()` plugin in `vite.config.ts`.                                                                                                                                                         |
| `tsconfig` extends `$app/tsconfig` | Generated into `node_modules/$app`. It supplies the recommended compiler options, so ours holds almost nothing — and no `paths` entry for `#lib`.                                                                       |
| `dev` from `$app/env`              | `$app/environment` is deprecated. `dev` is statically replaced, so the debug readout is eliminated from the kiosk bundle rather than merely hidden.                                                                     |
| `src/env.ts` + `$app/env/public`   | Environment variables are declared with a schema instead of a hand-written `ImportMetaEnv`. `PUBLIC_TILE_SERVER_URL` is `static`, so its value is **inlined at build time** — verified in the built chunk, not assumed. |

`src/env.ts` deliberately declares only the PUBLIC variable. The server-side
ones (`TILE_DIR`, `AERO_TILE_REMOTE_FALLBACK`) stay as injected parameters on
`lib/server/tiles.ts`, because that is what lets the tests assert the
fail-closed behaviour directly — including the `NODE_ENV` fallback, which no
declarative schema can express.

One cost worth knowing: `$app/env/public` is a virtual module that reads
`globalThis.__sveltekit_dev` in dev, so importing it outside a running Kit app
throws. `tests/setup.ts` stands in for that global; without it, any test that
transitively imports the tile templates fails at import time.

There is no `actions.ts` layer any more. Actions existed to push state into an
imperative globe each frame; MapLibre takes state as component props, so the
only imperative call left is the one `map.jumpTo()` in `+page.svelte`. The
`terrarium.ts` decoder went the same way — MapLibre decodes terrarium PNGs
natively via `encoding="terrarium"`, so our hand-rolled
`(R*256 + G + B/256) - 32768` had no caller.

The surviving `model.ts`/`rules.ts` files are exactly the parts that never knew
what a renderer was, which is why swapping the engine cost them nothing.

Three files carry the weight, and each is pure:

- **`window/params.ts`** turns a `URL` into `WindowParams`. Every knob is
  finite-checked, because `Number('abc')` is `NaN`, a `NaN` azimuth aims the
  camera at a `NaN` target, and that is a black screen with nothing in the
  console. Called from `+page.ts`'s `load`, so the component never reads
  `location` and a test never needs a browser.
- **`flight/look-target.ts`** converts eye position + azimuth + depression into
  a ground point. Pure trig, no renderer.
- **`flight/view.ts`** composes the two into `windowView(wallT, params)` — the
  entire aircraft state for one instant. The page's frame callback holds no
  maths at all: it calls this, then hands the result to `map.jumpTo`.

`view.ts` is also what makes the fleet claim checkable. `tests/state.test.ts`
calls the same function the page calls, so "three Pis agree at the same
instant" is asserted against the live path rather than against a copy of the
maths that can quietly drift.

| role           | file          | contract                                                          |
| -------------- | ------------- | ----------------------------------------------------------------- |
| **M**odel      | `model.ts`    | shapes + their canonical values. **Imports nothing.**             |
| **R**ules      | `rules.ts`    | pure functions over the model. **Never a renderer, never runes.** |
| e**X**perience | `components/` | the components a person looks at                                  |

**A**ctions is currently empty by design (see above): MapLibre's props absorbed
that role. Reintroduce it only if something needs per-frame imperative pushes.

`.svelte.ts` means the file holds runes. No `index.ts` barrels — every import
names its exact module, which is what keeps the cycle check honest.

## Not an ECS

There is one entity — the `Map` — so an entity table would be a `Map` with one
key. Add the entity dimension when props arrive (wing, clouds, sun), not before.

## Composition

`/` does not go through a `Scene`. MapLibre's declarative sources and layers
ARE the composition, and they are grouped by what they draw:

```
+page.svelte            map handle, frame loop, nothing else
  GroundLayers.svelte     GIBS base + NAIP detail + DEM (terrain & hillshade)
  AtmosphereSky.svelte    Sky, driven by the current atmosphere band
  DebugReadout.svelte     DEV only
```

That works because MapLibre's reactive prop layer does the job a `Scene` exists
to do for an imperative API. The split is by **concern**, not by file size: the
page owns the imperative handle, and each component owns one visual subsystem
and the constants that belong to it.

## Data flow

```
src/env.ts → $app/env/public                PUBLIC_TILE_SERVER_URL, inlined
+page.ts  load(url) → WindowParams          knobs, resolved once, finite-checked
window/game-loop  RAF
  → windowView(wallT, params) → WindowView  primaries: pose, altitude, target
  → resolveAtmosphere / nightLighting       derived with $derived
  → map.jumpTo(...) + reactive layer props
```

No `FlightFrame`/`RenderFrame` boundary object on this path — there is one
consumer, so nothing is serialized across a layer to disagree with its
inputs. Introduce one if a second consumer appears.

The rule that outlived the old boundary object: send **primaries only** across
any layer you do introduce. Derived state that travels can disagree with its
inputs, and on three screens that disagreement is a visible tear.

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

Elevation is a **heightmap**, not a mesh pack. MapLibre decodes terrarium PNGs
natively (`encoding="terrarium"`), so there is no decoder and no fallback
ladder of ours: a `RasterDEMTileSource` either has data or the tile is missing.
One fetch drives two uses — the displaced terrain mesh and the hillshade.

Elevation goes through `/api/tiles` like everything else, so a local pack is
used when one exists and the deployment decides whether misses may be proxied.
`remoteTileUrl()` is the single place that answers "can this kiosk reach the
internet, and for what" — terrarium is on that allowlist; nothing else needs to
be for the ground to work.

Reachability is asked of the tile server via `/health`, never of
`navigator.onLine` — which reports true on a LAN with no route out.

> **Still open:** with no local pack and no `AERO_TILE_REMOTE_FALLBACK=1`, a
> production kiosk has no elevation and no imagery. That is now an explicit
> deploy choice rather than a hidden internet dependency, but the real fix is
> shipping the packs so neither is needed.

## Invariants

1. Single Map — `/` holds a single `maplibregl.Map`, captured once via `bind:map`.
2. Renderer isolation — only `+page.svelte` and `lib/components/*.svelte` import
   MapLibre. Everything under `flight/`, `world/` and `window/` imports no
   renderer at all, which is what made replacing the engine a route-level change
   rather than a rewrite. Keep it that way.
3. No renderer maths in components — a frame callback calls `windowView()` and
   applies the result. If maths appears in a `.svelte` file, it cannot be tested
   without a WebGL context, and the fleet-determinism claim stops being checkable.
4. Runes live in `.svelte.ts`; `model.ts` and `rules.ts` never hold them.
5. Offline tiles — `/api/tiles` first, **imagery and elevation alike**; remote proxy only when
   `NODE_ENV=development` or `AERO_TILE_REMOTE_FALLBACK=1` (fails closed on unset, so the Pi never
   silently reaches the internet); a blank tile / flat ellipsoid otherwise — there is no Ion
   fallback any more, Cesium is gone. Every reachable remote origin is listed in `remoteTileUrl()`
   and nowhere else.
6. Fleet determinism — every pose is an absolute function of wall-clock time.
   No per-process epoch, no accumulated `dt`, no `Math.random()` in the hot path.

## Verified mechanically each pass

- no import cycles
- no upward imports across the layering
- `model.ts` imports nothing; `rules.ts` names no renderer
- every tile template resolves to `/api/tiles`, never an upstream host
