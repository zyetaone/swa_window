# ADR-006 — aero-2 window dressing: native/CSS first, Three.js only if that's not enough

> Status: Proposed (2026-08-25). Not started — no overlay code exists yet.
> Builds directly on [ADR-005](ADR-005-aero-2-threlte-renderer.md) (MapLibre
> promoted to `/`, Cesium deleted). Informed by
> [ADR-004](ADR-004-three-js-canonical-renderer.md)'s `hybrid-v2` (real,
> shipped Pi-5 prior art for the Three.js fallback path) and by an
> independent production case (Cesium community thread, "Best Practices for
> Hybrid MapLibre/Cesium Architecture") that hit the same render-to-texture
> trap this ADR explicitly avoids.

## Context

`/` today is MapLibre-only: raster imagery (GIBS day, USGS US-detail),
raster-DEM terrain (terrarium), MapLibre's flat-gradient `Sky`. Three things
are missing that aren't optional polish — clouds, a believable sky, and
night lighting that shows city structure. The original draft of this ADR
reached for a Three.js overlay to build all three. That was reaching past
cheaper rungs that were never actually tried.

### The ladder, applied to this specific gap

1. **Does a second renderer need to exist at all?** No — checked below,
   each of the three layers has a same-stack answer.
2. **Native platform / already-installed dependency covers it?** Yes, for
   two of the three:
   - **Atmosphere** — MapLibre's `<Sky>` component (already a dependency,
     already rendered) has an `atmosphere-blend` prop, unset today. Try it
     before writing a shader.
   - **Night lights** — a fourth MapLibre raster layer (GIBS VIIRS/Black
     Marble), opacity tied to `nightFactor`, same pattern as the existing
     GIBS/USGS/terrarium layers. No new dependency, no new renderer.
   - **Clouds** — the current route (built by a concurrent session while
     this ADR was being written) already stacks plain DOM/CSS layers over
     the MapLibre canvas — `GlassLayer`, `WindowFrame`, `CabinBlind`. Project
     memory already ran the cloud-technique A/B and CSS/PNG sprite stacking
     won over GLSL noise; v1's shipped cloud technique was CSS 3D, not
     WebGL. Clouds are one more layer in a stack that already exists and
     already works: cloud-PNG cards, `translate3d`/`perspective` driven by
     altitude and heading. No canvas, no camera to keep in sync, because
     there's no second camera.
3. **Only if 1-2 don't hold** does a second renderer get considered — and
   even then, evidence from this thread's own research points at MapLibre's
   `CustomLayer` (shared WebGL context) over a second camera-mirrored
   canvas: an unrelated production team independently concluded "a shared
   single WebGL context seems like the only viable path to hit performance
   goals" after trying — and being burned by — rendering one engine's output
   to a texture and draping it on the other (VRAM overhead, frame drops,
   distortion). That confirms two things already decided here: never
   render-to-texture between the two, and if a second renderer is ever
   needed, share the context rather than mirror a camera across two.

### What stays from the original draft, demoted not deleted

`world-lighting`-style SSOT discipline still applies even without a second
renderer: `nightFactor` (existing) and an `altitudeDetailMix`-equivalent
(new) are the one place "how much night/detail" gets decided, read by
whichever layers need it — this was never actually about keeping two
renderers in sync, it was about not computing the same derived value twice
and having them drift. Still true with zero renderers or two.

If CSS clouds and `atmosphere-blend` turn out not to sell "believable
window," the Three.js path from the original draft is the fallback, not
deleted: two-canvas camera-mirrored first (proven on Pi-5 hardware via
ADR-004's `hybrid-v2`), `CustomLayer` single-context as a follow-up spike
once there's a baseline to A/B against. Nothing below forecloses that; it's
just no longer the starting assumption.

## Decision

Build native/CSS first. No new dependency, no new rendering surface, no
renderer-isolation invariant to add yet — everything lands inside the
DOM+MapLibre stack that already exists.

### Shape

```
src/lib/
  world/
    lighting/  rules.ts       existing nightFactor + NEW altitudeDetailMix
    clouds/    model.ts  rules.ts   NEW, pure — coverage/position as f(altitude, heading)
  components/
    stage/GroundLayers.svelte  existing — + VIIRS raster layer, day-layer
                                darkening tied to nightFactor
    stage/AtmosphereSky.svelte existing — + atmosphere-blend
    chrome/CloudLayer.svelte   NEW — CSS cloud cards, same pattern as
                                GlassLayer/WindowFrame/CabinBlind
server/tiles.ts                remoteTileUrl(): + 'viirs' case
```

(Folder names follow whatever the concurrent session's `lib/components/`
split settles as — reconcile naming once that tree is stable, don't fight
it.)

## Phased plan

| Phase | Work | Depends on |
|---|---|---|
| 1 | VIIRS raster layer + day-layer darkening, both tied to `nightFactor` | `remoteTileUrl()` case |
| 2 | Try `atmosphere-blend` on `<Sky>`; keep if it reads right, drop the idea of a custom shader if it does | — |
| 3 | `clouds/model.ts`+`rules.ts` (pure), `CloudLayer.svelte` (CSS cards) | Phase 1's `nightFactor`/detail pattern, for lighting-consistent clouds |
| 4 | Pi-5 baseline fps with all of the above — the never-run ADR-005 Phase 1 gate, finally measured | Phases 1-3 |
| 5 (fallback, only if 1-3 don't look right) | Two-canvas camera-mirrored Three.js overlay, ADR-004-proven shape | Phase 4 baseline exists |
| 6 (spike, further fallback) | `CustomLayer` single-context version, A/B'd against Phase 5 | Phase 5 |

Phases 1-3 ship all three missing layers with zero new dependencies. Phase 4
is the honest checkpoint: measure before deciding whether Phase 5 is even
needed, rather than building it on the assumption that CSS wasn't enough.
