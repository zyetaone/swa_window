# ADR-006 — aero-2 sky overlay: MapLibre stays ground truth, Three.js owns orientation-only layers

> Status: Proposed (2026-08-25). Not started — no overlay code exists yet.
> Builds directly on [ADR-005](ADR-005-aero-2-threlte-renderer.md) (MapLibre
> promoted to `/`, Cesium deleted). Directly informed by
> [ADR-004](ADR-004-three-js-canonical-renderer.md)'s `hybrid-v2` — the
> nearest thing to prior art this decision has, and it is real, shipped,
> Pi-5-hardware prior art, not a guess.

## Context

`/` today is MapLibre-only: raster imagery (GIBS day, USGS US-detail),
raster-DEM terrain (terrarium), and MapLibre's own flat-gradient `Sky`. Three
things are missing that existed in v1 and are not optional polish — they're
what makes a static wallpaper read as a real window: clouds, a
physically-plausible sky, and night lighting that shows city structure
instead of a flat overlay.

Keep MapLibre as the ground engine — it already solved tile-pyramid/DEM/
projection, and the product's scenes are bounded per-location, not a true
globe, so nothing here needs Cesium's ellipsoid. Add a thin overlay for
**clouds and atmosphere only** — see "Night lights stay in MapLibre" below
for why that layer isn't part of the overlay after all.

### Direct precedent: ADR-004's `hybrid-v2`, already shipped

v1 ran the identical shape — base engine (Cesium there) + transparent
Three.js overlay for photoreal layers, camera-mirrored each frame — and per
project memory it has been **live and ungated on the fielded SWA Hyderabad
Pis since 2026-07-27**, and **won the Jul-8 night/dawn visual A/B**. The
formal P8 Pi-5 fps gate was never run before it shipped — a process gap, not
evidence of a performance problem.

Two implementation choices carry over directly:

1. **Camera sync by mirroring, not by injection.** v1's overlay ran in its
   own canvas and copied Cesium's camera transform into Three's camera every
   frame — it could not share Cesium's WebGL context. `svelte-maplibre-gl`
   (already an aero-2 dependency) offers a newer option ADR-004 didn't have:
   a documented `<CustomLayer>` component that shares MapLibre's own WebGL2
   context directly, no second canvas. But the mirrored-two-canvas shape has
   an actual Pi-5 production track record in this product; `CustomLayer` has
   **zero Pi-5 evidence either way**. Evidence beats elegance here — build
   two-canvas-mirrored first, treat `CustomLayer` as a follow-up spike A/B'd
   against a working baseline, not the starting assumption.
2. **One SSOT for lighting response, imported by both renderers.**
   `world-lighting/curves.ts` (`lightingState`, `altitudeDetailMix`) was a
   framework-free pure module both the Cesium and Three sides read — why v1
   didn't get a "white horizon seam" from each renderer deriving night
   independently. aero-2 has the seed of this in `world/lighting/rules.ts`
   (`nightLighting.factor`); it needs an `altitudeDetailMix`-equivalent
   added, not invented fresh.
3. **VIIRS-driven night lights were point lights, not a flat blend.** v1's
   `CityLightField` placed a bokeh carpet of point sprites sampled from
   VIIRS data. Richer than "alpha-blend a VIIRS raster tile" — see below for
   why that stays relevant even though the overlay isn't where it lives.

## Decision

Overlay = **clouds + atmosphere only**, two canvases, MapLibre camera
mirrored into a plain-Three (not Threlte) scene. `three` is the only new
dependency — the overlay's content (a handful of billboard sprites, one
fullscreen shader) is small enough that Threlte's declarative sugar buys
little here and costs a dependency neither implementation option needs.

### Night lights stay in MapLibre, not the overlay

Both the cheap version and the richer fallback are geospatial — a raster
tile blend or VIIRS-positioned point sprites — which contradicts "the
overlay renders nothing geospatial" (invariant 7 below) if either lives in
`SkyOverlay`. They don't need to: a raster layer or a symbol/vector layer is
exactly what MapLibre already does for GIBS/USGS. So:

- **Cheap first cut:** VIIRS as a fourth MapLibre raster layer, opacity tied
  to `nightFactor`, alongside darkening the GIBS day layer under it with the
  same factor (`raster-brightness-max`/`raster-saturation` — otherwise night
  renders as full daylight imagery with light dots on top, not night).
  Check the VIIRS layer's max zoom before committing to this — Black Marble
  is typically served coarser than the GIBS day layer, so it may need the
  bokeh fallback sooner than expected at Hyderabad's 400 m floor.
- **Fallback if the blend doesn't read as structured:** v1's point-sprite
  technique, as a MapLibre symbol layer sampled from VIIRS — still no Three
  involved.

This also means invariant 7 needs no caveat: the overlay's job is now
strictly clouds + atmosphere, both genuinely orientation-only.

### Shape

```
src/lib/
  world/
    lighting/  rules.ts       existing nightFactor + NEW altitudeDetailMix,
                               shared SSOT both renderers read
    clouds/    model.ts  rules.ts   NEW, pure — coverage/density as f(altitude)
  experience/
    probe-camera.ts           existing — MapLibre eye/target
    GroundMap.svelte          NEW — extracted from +page.svelte; the ONLY
                               subtree that imports MapLibre. Owns imagery,
                               terrain, and the VIIRS night-light layer.
    SkyOverlay.svelte         NEW — second canvas, clouds + atmosphere only;
                               the ONLY subtree that imports `three`
    sky-overlay.ts             NEW — Three.js scene/camera-mirror class,
                               driven by primaries computed once at the root
src/routes/
  +page.svelte                composition root only: URL params, ONE
                               game-loop tick, computes primaries once
                               ({ lat, lon, aglM, windowHeadingDeg, pitchDeg,
                               timeOfDay }), hands identical values to both
                               children — extends invariant 5 (fleet
                               determinism) to two canvases instead of a new
                               numbered rule
server/tiles.ts                remoteTileUrl(): + 'viirs' case, GIBS
                               Black Marble/VIIRS DNB WMTS layer — same
                               offline-tiles pattern as gibs/usgs/terrarium
```

### New invariants (append to `docs/ARCHITECTURE.md` once built)

6. Renderer isolation, per subtree — `experience/GroundMap.svelte` is the
   only place MapLibre is imported; `experience/SkyOverlay.svelte` is the
   only place `three` is imported. Neither imports the other's renderer.
7. The overlay renders nothing geospatial — clouds and atmosphere are
   functions of orientation, altitude, and sun angle, never lat/lon.
   Anything that needs the ground's real position (including night lights)
   is a MapLibre layer.

## Open items

- **`svelte-maplibre-gl/vite` plugin is not registered in `vite.config.ts`.**
  The library's own docs mark it "Required only for GL JS v6+," and
  `package.json` pins `maplibre-gl: ^6.6.0`. Possibly related to the
  stale-worker Vite error hit earlier this session — not confirmed. Folded
  into Phase 1.
- **`atmosphere-blend` on MapLibre's `<Sky>`** is a native property aero-2's
  current `<Sky>` doesn't set. Try it before hand-building a Bruneton shader
  in Phase 5 — native-feature-covers-it beats a custom pass if close enough.

## Phased plan

| Phase | Work | Depends on |
|---|---|---|
| 1 | Extract `GroundMap.svelte` from `+page.svelte` (no behavior change) + register `svelte-maplibre-gl/vite` | — |
| 2 | VIIRS raster layer + day-layer darkening, both tied to `nightFactor` | `remoteTileUrl()` case |
| 2.5 | Pi-5 baseline: fps of `GroundMap` alone, cruise + city-approach — the never-run ADR-005 Phase 1 gate, done here instead of skipped again | Phase 2 |
| 3 | `SkyOverlay.svelte` scaffold: second canvas, camera-mirror matching MapLibre's actual FOV (not Three's 50° default), renders nothing yet | Phase 2.5 baseline exists |
| 4 | `clouds/model.ts`+`rules.ts`, sprite billboards in the overlay | Phase 3 |
| 5 | Atmosphere pass — only after checking `atmosphere-blend` isn't already good enough | Phase 3 |
| 6 | Pi-5 measurement: overlay ON vs OFF against the Phase 2.5 baseline — this project's own P8 gate, run for real this time | Phases 3-5 |
| 7 (spike, optional) | `CustomLayer` single-context version, A/B'd against Phase 6 | Phase 6 |

Phases 1-2.5 ship real value (night lights) and a real number (baseline fps)
before any overlay code exists. Phases 3-5 are additive and individually
deletable. Phase 6 is the gate this project has a documented habit of
skipping under ship pressure — named up front, with a baseline already in
hand, so there's no excuse to skip it again.
