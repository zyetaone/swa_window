# ADR-005 — Threlte as aero-2's Renderer

> Status: **Proposed** (2026-08-25). Gated on one spike: Denver, side by side
> with the Cesium build, on a Pi 5. Not to be treated as decided until that runs.
>
> Scope: `aero-2/` only. Does **not** supersede ADR-001/002/003, which describe
> the Cesium pipeline shipping at SWA Hyderabad and remain valid for v1.
> Relates directly to ADR-004 (Three.js as v1's canonical renderer), which has
> been "in hardware validation" since 2026-06-15 and whose P8 gate has never
> been run.

## Context

### The premise that changes everything

aero-2 renders one place at a time, from ~10 km, obliquely. At that altitude the
horizon is **357 km** (3.57·√h). A 500 km cap covers everything visible, with
margin, permanently.

**We never need a globe.** Cesium's central competency — streaming a planet —
is infrastructure we pay for and never use.

### What aero-2 actually uses Cesium for

| Cesium capability | aero-2 |
|---|---|
| `skyBox`, `skyAtmosphere` | disabled |
| `showGroundAtmosphere` | disabled |
| camera controller | bypassed — `setView` every frame |
| fog | driven by hand from our own bands |
| all 10 widgets | off |
| tile pyramid | one fixed region, never global |
| terrain streaming | 96 lines of ours (terrarium → `HeightmapTerrainData`) |

What remains in use is roughly a textured-sphere rasteriser with imagery
reprojection. Every visual decision the product makes, we make against Cesium
rather than with it.

### The look is shader work

The atmosphere layer cake, aerial perspective, distance-blended detail texture,
and night emissive are all fragment-shader problems. In Cesium they are
`PostProcessStage` workarounds. ADR-001 identified exactly this when rejecting
MapLibre: *"the color grading shader and cloud post-process are Cesium
PostProcessStage — MapLibre has no equivalent compositing pipeline."* Three's
native idiom is materials and passes.

### Licence constraint (2026-08-25: "no licences, all free")

Neither renderer is the problem — CesiumJS is Apache-2.0, Three is MIT. The
**data** is:

| layer | status |
|---|---|
| esri-world-imagery (160 MB, primary day texture) | ArcGIS terms — **not open** |
| eox-sentinel2 (`s2cloudless-2024`) | needs EOX Commercial Attribution-RestrictedUse |
| cartodb-dark | CARTO terms — v1 already removed this once; aero-2 reintroduced it |
| viirs-night-lights (NASA GIBS) | public domain ✓ |
| terrarium elevation (AWS Open Data) | open ✓ verified live |
| OSM roads/buildings (8 cities, extracted) | ODbL + attribution ✓ |

Dropping the first three removes **188 MB of the 190 MB tile cache** and leaves
aero-2 with no day imagery until NASA GIBS true-colour (public domain,
~250 m/px) replaces it. This cost is independent of the renderer choice, but it
pushes toward baked assets either way — and baked assets are Three's model,
not Cesium's.

### Evidence gathered

Terrain relief, measured from terrarium source data rather than assumed:

| place | z8 tile ≈ | low → high | relief |
|---|---|---|---|
| denver | 120 km | 1 479 → 4 257 m | **2 778 m** |
| hyderabad | 149 km | 157 → 724 m | 567 m |
| dubai | 142 km | −53 → 1 614 m | 1 667 m (142 m near the city) |

Terrain is a **per-place property**, not a global feature. Denver earns a
heightmap; Hyderabad is a flat sheet from 10 km and is carried by texture and
light.

### Migration cost is already half-paid

aero-2's tree separates model/rules from actions, enforced mechanically (no
cycles, no upward imports, `model.ts` imports nothing, no `rules.ts` names
Cesium). Orbit, climb, bands, imagery selection and night factor are
renderer-agnostic and port untouched. Only the five `actions.ts` files change,
from Cesium calls to material uniforms.

## Decision

Adopt **Three.js + Threlte** as aero-2's renderer, with the world expressed as
declarative components:

```svelte
<CabinWindow>                        <!-- experience: aperture, glass, vignette -->
  <Canvas>
    <FlightCamera />                 <!-- experience/flight -->
    <World place={denver} time="16:00" weather="cloudy" />
  </Canvas>
</CabinWindow>
```

`<World>` mounts a default layer stack — terrain, base colour, detail, night
lights, sky — overridable by passing children. Props make every combination
addressable, which is how the visual work gets reviewed as a contact sheet
instead of by memory.

Assets are **baked offline per place**, not streamed: one heightmap, one base
colour layer, one detail insert, one night emissive. MARTINI runs at bake time,
not runtime — the camera sits at a fixed altitude over a fixed place, so
adaptive LOD buys nothing.

## Consequences

**Gained**
- ~3.5 MB cold bundle → ~500 KB; 200–400 MB RAM → a fraction (ADR-001 figures)
- Full shader control over the thing that *is* the product
- Composition becomes readable markup rather than a maintained array
- No tile server at runtime; PMTiles or plain files
- Threlte 8 / three 0.183 are already dependencies of v1 and already on the Pis

**Lost**
- Cesium's geodetic camera, tile reprojection, and imagery/terrain registration
- Four ADRs of operational knowledge that assume the Cesium pipeline
- The ability to fly anywhere without preparing assets first

## Risks

**The bake pipeline is the real cost, not the rendering.** Cesium's gift is that
nothing needs baking: tiles stream, reprojection is handled, imagery and terrain
align themselves. Owning that offline means Sentinel-2/GIBS mosaicking, cloud
masking, WebMercator→local reprojection, and pixel-accurate registration between
heightmap and colour. **Misalignment reads as a bug and cannot be fixed at
runtime.** If this turns out to be weeks rather than days, Cesium wins on
shipping.

Secondary: texture memory. 4096² RGBA is 67 MB uncompressed; a base plus a
detail layer on three Pis needs KTX2/Basis compression. Unmeasured.

## Alternatives considered

**Cesium native.** Lower risk, ships sooner, works today — terrarium elevation
landed in 96 lines. Rejected because we use ~5% of it, fight the rest, and
cannot express the layer API. Remains the fallback if the spike fails.

**MapLibre.** Rejected in ADR-001 because *"the visual identity of Aero Window
IS Cesium"* — atmosphere scattering, sun/moon, ocean, bloom. **That reason is
void for aero-2: we have disabled every one of those.** The reason that still
holds is the absence of a compositing pipeline; we would bolt Three on for the
passes anyway. Worth stealing regardless: PMTiles, and its ~40 MB RAM figure as
a target.

**Pre-rendered video.** Rejected in ADR-004 and not revisited.

## Reversal criteria

Return to Cesium if any of these hold after the spike:

1. The bake pipeline cannot produce a registered heightmap + colour pair for one
   place in under a day of work.
2. The Three build does not look better than the Cesium build at the same instant
   and place.
3. Pi 5 cannot hold frame budget with the baked mesh and compressed textures.

## Spike (the gate)

One scene, one day: Denver, terrarium → MARTINI mesh at bake time, NASA GIBS
true-colour base, existing `flight/rules.ts` driving a Three camera, side by
side with the Cesium build on a Pi 5.

This also discharges ADR-004's P8 gate, which has been open since June while the
fleet ships `useThreeOverlay: true` unmeasured.
