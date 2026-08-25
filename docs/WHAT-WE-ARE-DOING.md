# Aero Window — what we are trying to do

**Status of this document:** written 2026-08-25, after a session that ended with
MapLibre serving `/` in `aero-2` and Cesium deleted from that codebase. It is a
briefing, not a decision record. The decisions live in `docs/ADR-00*.md`.

---

## 1. The product

A **digital airplane window** for an office wall. Not a map, not a globe demo, not
a screensaver with a globe in it. The success criterion is that someone glances up
from a desk, sees the ground moving past at cruise altitude, and feels the thing an
airplane window makes people feel: calm, distance, being in transit.

Concretely, at SWA Hyderabad:

- **Three Raspberry Pi 5s**, three portrait panels side by side, forming one
  continuous panoramic window. Same aircraft, same clock, same weather, three
  camera azimuths whose frusta tile into a single view.
- **Circadian-aware** — local time at the place being flown over drives the
  light.
- **Headless Chromium kiosk**, boots into the view, runs unattended for months.
- **Offline-capable.** A fielded device must not depend on a route to the
  internet. Tiles come from a local pack; remote fetch fails *closed*.
- **No licences, all free** (constraint restated 2026-08-25). Every data source
  must be public domain or open — NASA GIBS, AWS terrarium, USGS NAIP, OSM.
  This killed Esri, EOX s2cloudless and CARTO, which had been 188 MB of the
  190 MB tile cache.

## 2. Why the renderer question exists at all

The premise that reframes everything (ADR-005):

> aero-2 renders **one place at a time, from ~10 km, obliquely**. At that
> altitude the horizon is 357 km. A 500 km cap covers everything visible,
> permanently. **We never need a globe.**

Cesium's central competency is streaming a planet. If we never need a planet, we
are paying for infrastructure we do not use. ADR-005 audited what v1 actually
used Cesium *for*:

| Cesium capability | aero-2's use |
|---|---|
| `skyBox`, `skyAtmosphere` | disabled |
| `showGroundAtmosphere` | disabled |
| camera controller | bypassed — `setView` every frame |
| fog | driven by hand from our own bands |
| all 10 widgets | off |
| tile pyramid | one fixed region, never global |
| terrain streaming | 96 lines of ours (terrarium → `HeightmapTerrainData`) |

What remained in use was "roughly a textured-sphere rasteriser with imagery
reprojection." Every visual decision was made *against* Cesium rather than with
it.

## 3. Where the two codebases stand

| | **v1** (`/`, ships today) | **aero-2** (rewrite) |
|---|---|---|
| Ground | CesiumJS 1.143 | MapLibre GL 6 |
| Overlay | Three.js 0.183 + Threlte 8, `useThreeOverlay` default ON | none |
| Chrome | CSS layers | CSS layers |
| Deployed | Yes, SWA Hyderabad | No |
| Bundle | ~3.5 MB cold | 2.7 MB total build |

v1 is **already a hybrid**: Cesium draws the globe, a transparent Three canvas
sits above it for clouds/wing/neon, and the Three camera is *pulled* from Cesium
each frame. That hybrid has never had its performance gate run — ADR-004's P8
Pi-5 measurement has been open since 2026-06-15 while the fleet ships the
overlay enabled and unmeasured.

## 4. What actually happened in aero-2, honestly

1. ADR-005 proposed **Three.js + Threlte**, with terrain baked offline per place.
2. Before that spike ran, a **MapLibre probe** was built as a composition test.
3. The probe's blur problem — Hyderabad has no licence-clean high-res imagery —
   was solved not with better imagery but with **hillshade off the DEM we were
   already fetching**. Structure reads as sharpness; pixel count does not.
4. That killed the expensive branch. GIBS (306 m/px) + terrarium + hillshade
   looked good enough.
5. On the strength of **one look on a Mac**, MapLibre was promoted to `/` and
   Cesium was deleted.

**This is not what ADR-005 argued for**, and the ADR says so in its own words.
The gate was a Pi 5 side-by-side. It never ran. The decision was made on
"I like it," which the ADR defends as legitimate for a display whose entire job
is being liked — while naming the gap plainly.

## 5. The open questions (the honest list)

- **No Pi 5 measurement exists for the MapLibre path.** Not faster, not slower.
  Unmeasured. ADR-004's P8 gate is still open, and now open for a *different*
  renderer than the one it was opened for.
- **Seen once, on a Mac, at desk distance, in landscape.** The product is three
  portrait panels seen from across a room, and "calm" is a property of *duration*
  — a view can be pleasant for ten seconds and irritating for an hour.
- **Two band-system properties do not reach the screen.** `deckOpacity` (cloud
  deck) and the night emissive blend are computed and tested but unwired,
  because MapLibre **drapes rasters over** terrain rather than giving the mesh a
  material. There is no fragment shader sampling base + detail + emissive and
  blending by distance.
- **Flight feel is unjudged.** Orbit speed, the 400 m → 13 000 m climb, floor
  altitude, and window azimuth were never separately assessed. Promotion
  answered "is the ground good enough," not "is the flight right."
- **Reversal is cheap but no longer free.** With Cesium deleted there is no live
  fallback route; reversing means `git revert`, not flipping a switch.

## 6. What ADR-006 proposes next

Clouds, a believable sky, and night lighting are the three missing layers. The
first draft reached for a Three.js overlay to build all three. The revision
applies a **cheapest-rung-first ladder** and finds same-stack answers for the
first two:

- **Atmosphere** — MapLibre's `<Sky>` already has `atmosphere-blend`, currently
  unset. Try the prop before writing a shader.
- **Night lights** — a fourth raster layer (GIBS VIIRS), opacity tied to
  `nightFactor`. Same pattern as the three layers already working.
- **Clouds** — CSS/DOM cards over the canvas. Project memory already ran this
  A/B: CSS/PNG sprite stacking beat GLSL noise, and v1's *shipped* cloud
  technique was CSS 3D, not WebGL.

Three.js stays on the table only for what genuinely needs a material.

---

## The question worth answering properly

Three renderers, three genuinely different bets, and we have now shipped or
half-shipped all three without measuring any of them on the target hardware:

- **Cesium** — geodetic correctness and streaming we don't need, in exchange for
  weight and fighting the framework for the look.
- **Three.js** — full shader control over the thing that *is* the product, in
  exchange for owning reprojection, registration and an asset bake pipeline.
  "Misalignment reads as a bug and cannot be fixed at runtime."
- **MapLibre** — the tile pyramid, DEM and projection problems already solved,
  a genuinely good camera API for this (`calculateCameraOptionsFromTo` puts the
  eye at a real altitude), in exchange for no terrain material and therefore a
  ceiling on the look.

The deep-dive prompt in `RENDERER-DEEP-DIVE-PROMPT.md` is written to attack
exactly this.
