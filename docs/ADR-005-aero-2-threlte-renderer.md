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

| Cesium capability         | aero-2                                                |
| ------------------------- | ----------------------------------------------------- |
| `skyBox`, `skyAtmosphere` | disabled                                              |
| `showGroundAtmosphere`    | disabled                                              |
| camera controller         | bypassed — `setView` every frame                      |
| fog                       | driven by hand from our own bands                     |
| all 10 widgets            | off                                                   |
| tile pyramid              | one fixed region, never global                        |
| terrain streaming         | 96 lines of ours (terrarium → `HeightmapTerrainData`) |

What remains in use is roughly a textured-sphere rasteriser with imagery
reprojection. Every visual decision the product makes, we make against Cesium
rather than with it.

### The look is shader work

The atmosphere layer cake, aerial perspective, distance-blended detail texture,
and night emissive are all fragment-shader problems. In Cesium they are
`PostProcessStage` workarounds. ADR-001 identified exactly this when rejecting
MapLibre: _"the color grading shader and cloud post-process are Cesium
PostProcessStage — MapLibre has no equivalent compositing pipeline."_ Three's
native idiom is materials and passes.

### Licence constraint (2026-08-25: "no licences, all free")

Neither renderer is the problem — CesiumJS is Apache-2.0, Three is MIT. The
**data** is:

| layer                                            | status                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| esri-world-imagery (160 MB, primary day texture) | ArcGIS terms — **not open**                                        |
| eox-sentinel2 (`s2cloudless-2024`)               | needs EOX Commercial Attribution-RestrictedUse                     |
| cartodb-dark                                     | CARTO terms — v1 already removed this once; aero-2 reintroduced it |
| viirs-night-lights (NASA GIBS)                   | public domain ✓                                                    |
| terrarium elevation (AWS Open Data)              | open ✓ verified live                                               |
| OSM roads/buildings (8 cities, extracted)        | ODbL + attribution ✓                                               |

Dropping the first three removes **188 MB of the 190 MB tile cache** and leaves
aero-2 with no day imagery until NASA GIBS true-colour (public domain,
~250 m/px) replaces it. This cost is independent of the renderer choice, but it
pushes toward baked assets either way — and baked assets are Three's model,
not Cesium's.

### Evidence gathered

Terrain relief, measured from terrarium source data rather than assumed:

| place     | z8 tile ≈ | low → high      | relief                        |
| --------- | --------- | --------------- | ----------------------------- |
| denver    | 120 km    | 1 479 → 4 257 m | **2 778 m**                   |
| hyderabad | 149 km    | 157 → 724 m     | 567 m                         |
| dubai     | 142 km    | −53 → 1 614 m   | 1 667 m (142 m near the city) |

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
- Full shader control over the thing that _is_ the product
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

**MapLibre.** Rejected in ADR-001 because _"the visual identity of Aero Window
IS Cesium"_ — atmosphere scattering, sun/moon, ocean, bloom. **That reason is
void for aero-2: we have disabled every one of those.** The reason that still
holds is narrower than ADR-001 put it, and worth stating accurately:

MapLibre covers more of the band system natively than expected — `sky-color`,
`horizon-color`, `fog-color` and the blend factors map onto `skyTop`,
`skyHorizon` and `fogDensity`; a raster crossfade covers `groundDetail`. Four
of six. What it cannot do is `deckOpacity` (no volumetric or mesh layer) and
the night emissive blend, because MapLibre **drapes raster layers over**
terrain rather than giving the terrain mesh a material. There is no fragment
shader sampling base + detail + emissive and blending by distance. The escape
hatch is a custom WebGL layer — raw GL against someone else's context, which is
strictly worse than using Three directly.

Camera correction, since it was asserted wrongly during evaluation:
**MapLibre has no `FreeCameraOptions`** — that is Mapbox GL JS. Its equivalent
is `calculateCameraOptionsFromTo(from, altitudeFrom, to, altitudeTo)`, which
derives centre/zoom/bearing/pitch from a real eye altitude and a look-at point.
Altitude genuinely positions the camera; it is not faked through zoom. This is
a better API for a flight view than it was given credit for.

Worth stealing regardless: PMTiles, and its ~40 MB RAM figure as a target.

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

---

## Phase 0 result — 2026-08-25

**The probe was looked at, and it looks good.** First time anything in this
line of work has been seen rather than reasoned about.

Configuration viewed was the bare `/lab/maplibre` URL, which is the hardest
case and the one that matters: **Hyderabad, 400 m AGL floor, no NAIP detail
layer (India is outside coverage), NASA GIBS z9 at ~306 m/px, hillshade 0.35.**

### What this settles

The blur complaint was resolved **without any high-resolution imagery**. The
fix was hillshade derived from the terrarium DEM already being fetched for the
terrain mesh — high-frequency luminance structure, not pixel count.

That kills the expensive branch. Before this, the reasoning ran: home location
needs ~0.78 m/px at its 400 m floor → no licence-clean source on Earth provides
it → therefore bake Sentinel-2, or build WorldCover-driven splat terrain. Both
were multi-day. Neither is needed if 306 m/px plus shading is enough, and it
appears to be.

**The licence squeeze is therefore not blocking.** Every rejected source
(Esri, EOX s2cloudless, CARTO) was rejected for imagery resolution we now have
evidence we do not need. GIBS + terrarium + OSM are all public-domain or open,
and that stack is sufficient.

### What this does NOT settle

Deliberately listed, because one look is one look:

- Seen on a Mac display at desk distance, in one landscape window. The product
  is three portrait panels seen from across an office. Different angular size,
  different viewing distance, different bezels.
- Not seen on a Pi 5. Says nothing about frame rate, thermals, or the P8 gate.
- Not held for twenty minutes. "Calm" is a property of duration; blur is not.
  A view can be pleasant for ten seconds and irritating for an hour.
- Orbit speed and the 400 m → 13 000 m climb were not separately judged. They
  remain the open Phase 0 questions.
- Hillshade at 0.35 over flat Deccan terrain does little. Denver is the case
  where it does the most, and where it might read as too much.

### Consequence for this ADR

The renderer decision is now **less** urgent, not more. The argument for
leaving Cesium was partly that its imagery path forced licence-encumbered
sources. That argument is weaker if the look can be carried by open data plus
shading, which the same rules drive under either renderer.

Phase 1 (the Pi 5 side-by-side) remains the real gate and is unchanged.

---

## Promoted to `/` — 2026-08-25

Explicit instruction, after looking at the probe: move it to the main route.
Done — `/` now serves MapLibre. A `/lab/cesium` reference route was created
and then, on a further explicit instruction, removed. Cesium's code
(`cesium/`, `window/scene.svelte.ts`, `window/aero-window.svelte.ts`,
`experience/CabinWindow.svelte`) still exists and still passes its tests; it
is simply unreferenced by any route.

**This is not the outcome the "Consequence" section above argued for.** That
section said the renderer decision had become _less_ urgent, precisely because
Phase 1 — the only measured, on-hardware answer — hadn't run. The promotion
happened anyway, on the strength of one look at a Mac, because "I like it" is
also a legitimate answer for a display whose entire job is being liked. Naming
the gap rather than smoothing over it:

- **No Pi 5 measurement exists for the MapLibre path**, in either direction. Not
  slower, not faster, not measured. The ADR-004 P8 gate this was meant to
  discharge is still open — it is now open for a _different_ renderer than the
  one it was opened for.
- **Reversal is cheap, but no longer zero-effort.** With no live fallback
  route, reversing means re-adding a route file, not swapping which of two
  already exists. Still small — `model.ts`/`rules.ts` back the Cesium wiring
  unchanged, so nothing downstream of routing needs to move — but it is a
  step this ADR previously described as already done, and now isn't.
- The five Phase 0 questions (orbit speed, climb profile, floor altitude,
  terrain relevance, window azimuth) are **still open**. Promotion answered "is
  the ground texture good enough," not "is the flight right."

Phase 1 remains the real gate. It now additionally needs to answer whether
demoting Cesium was correct, not only whether promoting MapLibre was.
