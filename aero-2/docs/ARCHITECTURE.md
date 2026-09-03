# Aero 2 Architecture

Three Raspberry Pi 5s stand side by side behind one window. They exchange
nothing. Everything below follows from that.

> MapLibre is the canonical renderer as of 2026-08-25. See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. The shape

Two feature slices under `src/lib/`, plus server-only tile streaming:

```text
settings/   the config SSOT and the operator drawers
display/    the kiosk window — world/, flight/, cabin/, media/
server/     the offline tile proxy; imports nothing from the two above
```

**There is deliberately no file listing here.** The previous version of this
document enumerated the tree, and by the time anyone read it the tree had
`Relief.svelte` and `Air.svelte` in it — files that were renamed a long time
ago — while `Clouds`, `Blind`, `RainGlass`, the media stage and the director
were missing. A diagram that has to be hand-updated on
every rename is a diagram that will be wrong, and a wrong map is worse than no
map. `ls` is accurate; this file holds the rules `ls` cannot show you.

Naming, so `ls` reads well:

- **`.svelte.ts` means the file holds runes.** `settings.svelte.ts` and
  `display.svelte.ts` do; the pure maths in `flight/` and `world/` does not.
- **No folder stuttering.** `world/Stage.svelte`, not `WorldStage.svelte`.
- **Each slice has one parent component** — `Display.svelte`, `Settings.svelte`
  — that owns its internals.

## 2. The invariants

Nine rules. Seven are enforced by something that fails; two are not, and are
marked so, because an unenforced invariant is an aspiration.

| #   | Invariant                                                                                  | Enforced by                                                                                    |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | No import cycles                                                                           | `tools/check-cycles.mjs`, in `check` and `test`                                                |
| 2   | The world is a pure function of (wall clock, place, `daySeed`)                             | `tests/integration.test.ts` — scans for `Math.random` and for `+= dt`                          |
| 3   | Context DI: `createDisplay()` at the root, `useDisplay()` below                            | —                                                                                              |
| 4   | The pure simulation modules import no renderer                                             | `tests/integration.test.ts`                                                                    |
| 5   | All tiles flow through `/api/tiles`; `server/tiles.ts` is the only file naming an upstream | `tests/tiles.test.ts`, `tests/regressions.test.ts` — templates AND every file under `display/` |
| 6   | The 3D world runs inside `<svelte:boundary>`                                               | —                                                                                              |
| 7   | No barrel files (`index.ts`)                                                               | —                                                                                              |
| 8   | A renderer projects the pose; it never sources it                                          | `tests/regressions.test.ts` — same second ⇒ same pose, on a cold model                         |
| 9   | Every page route renders, and the kiosk is actually flying                                 | `tools/smoke-routes.mjs` (`bun run smoke`)                                                     |

**#2 is the product.** No accumulated `dt`, no per-process epoch, no unseeded
randomness anywhere the window can see. Both failure shapes have bitten:
the director rolled an unseeded 2–5 minute interval AND integrated a clamped
`dt`, so three panes sat over three different cities; the cloud deck integrated
frame deltas in three places while its own docstring claimed determinism. The
fix in both cases was the same — derive from the wall clock, remember nothing.
Per-pane randomness is allowed only where it is genuinely per-pane and cosmetic
(cabin audio, rain on this pane's own glass), and that list lives in the test.

**#4 is narrower than it sounds, on purpose.** It does not say "only `world/`
touches MapLibre" — `flight/MiniMap.svelte` renders a map and needs one. It
says the _pure_ modules stay pure: `flight-path`, `view`, `parallax`,
`atmosphere`, `sun`, `settings`, `locations`. That layer is what a second
renderer reuses unchanged, and what the suite can exercise without a GPU. One
renderer import in any of them and a swappable engine quietly stops being
swappable. `import type` is exempt — it is erased at build time, so a renderer
bridge can name its engine's types and still cost the pure layer nothing.

**#8 is what makes #2 hold at the edges.** `AeroDisplay.advanceTo(wallSec)` is
the only place a pose comes from. Everything downstream — the stage, the
clouds, the wing, the rain, the HUD — reads `display.view` and draws it. The
moment a component reaches for `Date.now()` itself it has become a second
clock, and two clocks on one pane cannot be made to agree by making each of
them deterministic: the storm's lightning ran its own RAF sampling its own
`Date.now()`, so the flash landed on a millisecond the drawn frame was never
derived from. Determinism is a property of the graph, not of each node.

The one thing a renderer is allowed to source is terrain, because only it has
the DEM — and that is exactly why the clearance policy lives in
`world/clearance.ts` and reports whether the sample was real. See the
diagnostics readout in the admin drawer; a `0% sampled` reading means the
window is flying over a mean, not over ground.

**#9 is the only check that loads a page.** Everything above reasons about
source or calls a function; none of it mounts a route, so a component that
throws during init is green in `check`, green in the suite, and serves an empty
`<body>` with a 200. The parent repo shipped `/admin` in exactly that state with
489 passing tests. `curl` cannot see it either — `ssr = false` means the static
shell returns 200 whether or not the app boots inside it, so the guard on
`/admin` has to be checked on `__data.json`.

It also asserts the pose CHANGED between two samples, because a frozen window
is the failure that survives every other check: a stalled render loop leaves a
live canvas holding its last frame at a plausible altitude with a clean
console, which is a photograph of an aeroplane window and indistinguishable
from the product in a screenshot. Both assertions were verified by breaking the
code they cover — an init throw in `/admin`, and a disabled
`requestAnimationFrame` in `Stage` — and confirming the run goes red.

`bun run smoke` runs the built server with `NODE_ENV` UNSET, which is the Pi's
own configuration: the dev-only remote tile fallback is off, so the run sees
the real offline archive instead of quietly proxying NASA and passing on any
machine with internet.

**#6 and #7 are unenforced.** Both were violated within a day of being written
down: `Clouds` ran its own WebGL context outside the boundary until 2026-08-26,
so a Three.js context loss took the page down while the identical MapLibre
failure was caught and offered a retry. If either matters enough to keep, it is
a three-line source scan alongside the two already in `integration.test.ts`.

## 3. Engines

**There is one.** MapLibre GL, mounted unconditionally by `Display.svelte`.

There were two until 2026-08-31. `config.engine` switched between MapLibre and
Cesium, and Cesium came in through a runtime `import('cesium')` so the engine
you were not running cost nothing to boot. It was deleted rather than fixed:
no terrain provider was ever set, so it flew the regional mean — below the
local peak at five of eleven locations — and it named two upstream tile hosts
directly, which invariant 5 forbids and the scan of the day could not see.
`../docs/ADR-005` proposes Threlte as the eventual second renderer; Cesium was a
third option that was nobody's plan.

What survives the deletion is the shape, and it is worth keeping if a second
renderer arrives: the bridge owns the engine, `import type` keeps the pure
layer clean, and a source scan asserts the new stage advances the clock —
mounting a stage is not the same as driving one.

`three` — the cloud deck and the wing — is a static import and is always in the
main chunk. That asymmetry was not a decision; measure it on a Pi before
treating it as one.

## 4. Layers, outside in

```text
Stage                  the world              inside <svelte:boundary>
Clouds                 the deck               inside <svelte:boundary>
Wing                   the airframe           z 5
RainGlass, Frame, Blind  the cabin            z 10
MiniMap, Hud           instruments
Settings               operator drawers       z 100 (a snippet, injected)
```

Component visibility is gated in exactly one place: the config knob the
component itself reads. `Display.svelte` briefly had five boolean props
duplicating those knobs, of which its single caller passed one.

## 5. Known-sharp edges

- **Tile URL shape is load-bearing:** `/api/tiles/xyz/{layer}/{z}/{x}/{y}.{ext}`.
- **The tile archive lives in `data/`, never `static/`.** Under `static/` Vite
  copies and brotli-compresses all ~56k files into `build/` on every build
  (3.5 min, 11 GB) AND the adapter serves them directly, so
  `GET /tiles/terrain.pmtiles` answers 200 without the path guard, the symlink
  check or the Range logic — which quietly makes invariant 5 optional.
- **A present archive is not a working one.** `terrarium/` is build INPUT for
  `pack-pmtiles`; the kiosk never requests it. A pack holding only terrarium
  renders a white sheet, and the health endpoint called that `ok` for as long
  as it counted directories rather than asserting named assets. If you add a
  raster source, add it to `REQUIRED_TILE_ASSETS` in `server/tiles.ts` or
  nothing will ever tell you it is missing.
- **The packager must write the extension the client asks for.** GIBS ignores
  the extension in the request, so fetching `viirs` as `.jpg` returns 200 and
  writes a valid PNG at a path the server never looks up: "542 downloaded, 0
  failed", 4,534 dead files, and a kiosk that 404s on every one. `LAYER_EXT` in
  `download-tiles.ts` is the SSOT, and `integration.test.ts` asserts it against
  `tileTemplates()`.
- **A kiosk-visible tile radius is ~1,250 km, not ~50.** At cruise altitude on
  a globe projection the camera reaches most of a continent, so per-location
  corridors packed at a city radius leave holes that only appear at certain
  points in the orbit. Measure it — drive every location and log 404s — rather
  than reasoning about the bounding box.
- **Two colour photographs, deliberately.** `sentinel2` (packed to z13, 19 m/px,
  cloudless, per-location boxes) is laid over `gibs` (z9, 306 m/px, global,
  ~40% cloud). The
  overlay is what the window shows wherever it is packed; MODIS is the
  everywhere-layer beneath it, so a Sentinel-2 gap degrades instead of punching
  a hole. This is NOT the USGS/NAIP mistake that was deleted in 2026-08: that
  layer was a second photograph at a resolution the screen could not resolve.
  A 16x resolution gain is a different proposition.
- **Measured against v1, which is where this came from.** The parent repo's
  Cesium build looked better than aero-2 and the renderer was not the reason —
  it drew EOX s2cloudless while aero-2 drew MODIS. aero-2's pack is now the
  larger one: 16,352 tiles to z13 against v1's fielded 755 tiles to z12
  (`data/tiles/eox-sentinel2`, 15 MB). v1's code permits z14, but only from the
  REMOTE EOX service; its local path is capped at z12 and its offline pack
  stops there. Below z8 aero-2 has no Sentinel-2 and does not need it — MODIS
  is global to z9 and covers z0-7 outright.
- **The sharp basemap costs ~3-5 fps on a slow CPU, and the pack costs 312 MB.**
  Measured, because adding a second full-screen raster layer to a Pi kiosk is
  not obviously free. A/B at the same location under 6x CPU throttling (a rough
  Pi 5 stand-in): 17 fps with the layer visible, 22 with it hidden, repeated
  three times. Unthrottled it is 60 either way.
  Do NOT read the cross-location numbers as the layer's cost — packed locations
  measured 9-17 fps against 20-24 for unpacked ones, but that gap is mostly
  terrain: Denver and Phoenix are mountainous, Dubai and the Pacific are flat.
  Only the same-location A/B isolates the layer.
  Disk: 312 MB across 7 locations, against a 4.0 GB served total that the
  3.5 GB DEM dominates. If the SD budget ever binds, the DEM is the place to
  look, not the imagery.
- **Sentinel-2 imagery is licence-critical.** The convenient source (EOX
  s2cloudless) is CC BY-NC-SA and cannot ship on a paid install; v1 uses it and
  its own `upstream.ts` flags that as an open question. aero-2 builds the same
  pixels from `sentinel-cogs` under Copernicus terms, which permit commercial
  use AND REQUIRE attribution. `remoteTileUrl` returns null for this layer on
  purpose — a remote fallback would silently proxy the non-commercial service.
- **`{z}/{x}/{y}` and `{z}/{y}/{x}` are both called "XYZ".** `WMTS_TILE_PATH`
  in `server/tiles.ts` is the authority and reads `{z}/{y}/{x}`; `gdal2tiles
--xyz` emits the other one. On a square grid the two are indistinguishable by
  eye, and a wrongly-filed pack 404s every tile while the directory looks
  perfectly plausible and the packager reports success. Three of seven
  Sentinel-2 packs shipped this way — Hyderabad served 129 requests and 0 tiles
  with a complete archive on disk.
- **Never transpose a SHARED tile tree in place.** The layer directory holds
  every location, so a transpose that walks the whole tree flips the tiles a
  previous run already put right: with three places packed, whether any given
  one worked came down to parity. Tiles carry no record of their own
  orientation, so this cannot be made idempotent — stage per-run output
  elsewhere and MOVE it in. The test that catches it computes the tile each
  pack's own centre falls on and asks for it the way the server does;
  "listed" and "licensed" checks cannot see this.
- **The ground is ~30% cloud, and no date fixes it.** `GIBS_DATE` pins a single
  MODIS day, and MODIS true colour is a same-day swath: across the z6–z9 tiles
  the window requests, the best eligible day measures ~30% near-white and most
  measure 38–54%. Swapping dates moves it a few points. If the window looks
  washed out, that is the photograph, not the haze — verified by disabling the
  fog, the hillshade, the grade, the cloud deck, the CSS layers, the terrain and
  the sky itself and finding the ground still white. The real fix is a cloudless
  COMPOSITE (EOX s2cloudless measures 4.6% on the same metric) and is blocked on
  licensing, not on engineering. See the note above `GIBS_DATE`.
- **Rate imagery across every zoom the window DRAWS.** The camera reports zoom
  ~10 at 85° pitch, but `gibs` caps at maxzoom 9 and the frame is filled from
  z4–z9 at once. Two survey passes each measured the wrong slice — z8 near a
  location centre, then z6 alone — and the first scored a day at 13.1% that is
  really ~38%. Sampling z9 for the first time also revealed coverage holes that
  every earlier sweep missed: the previously pinned 2026-06-20 has no z9 tile
  east of Hyderabad, the fielded kiosk home.
- **A timeout is not a missing tile.** The survey counted both as absent
  imagery, so a flaky network fabricated coverage gaps and scored the same day
  11/11 and 10/11 minutes apart. 404 is authoritative; everything else is
  retried and reported separately.
- **Media modes need `media-src`, and it must be declared even when empty.**
  Without the directive, `<video>`/`<audio>` fall back to `default-src` and are
  blocked silently: the element fires `onerror`, MediaStage catches it, and the
  pane renders a tidy "Media failed to load" that reads as handled absence. All
  three non-flight modes shipped 100% broken this way. Extra origins go in
  `AERO_MEDIA_ORIGINS` at build time; the defaults are empty on purpose,
  because a kiosk that needs a CDN is a kiosk that goes blank with the WiFi.
- **`raster-opacity: 0` still fetches.** A faded-out source keeps requesting
  tiles at full rate; only unmounting stops it. `Ground.svelte` gates the VIIRS
  night-lights source behind `{#if nightLightOpacity > 0.01}` for that reason —
  it used to do the same for a USGS/NAIP layer that was deleted on 2026-08-26,
  where it was worth several hundred 404s a minute outside US coverage.
- **A DEM source without `minzoom`/`maxzoom` reads as sea level.** MapLibre
  assumes z0–22, requests tiles the archive does not hold, never decodes one,
  and `queryTerrainElevation` returns a literal `0` — indistinguishable from
  the ocean at the call site. Declare the range every time.
- **Altitude is metres above ground, and terrain is drawn at `exaggeration`×.**
  Mixing raw and drawn metres flies the camera through mountains.
