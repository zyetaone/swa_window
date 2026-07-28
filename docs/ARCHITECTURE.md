# AeroWindow Architecture (canonical)

> **Status (2026-07-28):** Phase 0 — target shape. Sections marked
> `[shipped]` / `[phase N]` reflect actual code state.
>
> See also: `AGENTS.md` for the subsystem pattern + reactive-feature
> idiom as it applies day-to-day.

---

## Five-layer engine stack

```text
                       AeroWindow
─────────────────────────────────────────────────────
                 SvelteKit Application
─────────────────────────────────────────────────────
+layout.svelte         +page.svelte
Pane                   HUD
Settings               Telemetry
─────────────────────────────────────────────────────
                Svelte 5 Reactive Model
─────────────────────────────────────────────────────
$state        — mutable world state (config, flight, weather, …)
$derived     — computed values (lighting, sun, nightMix, …)
$effect       — synchronisation only (push to Cesium)
─────────────────────────────────────────────────────
                  Cesium Native Engine
─────────────────────────────────────────────────────
Viewer      Scene      Camera     Clock      Globe
Terrain     Imagery    Buildings  Atmosphere
PostProcess  SkyAtmosphere  Fog  Sun  Moon
─────────────────────────────────────────────────────
                 Open Data Sources
─────────────────────────────────────────────────────
Terrain:     Copernicus DEM · Mapzen · SRTM
Imagery:     Sentinel-2 · Blue Marble
Night:       NASA VIIRS Black Marble
Buildings:   OSM Buildings · Google Open Buildings
Weather:     Open-Meteo · METAR · NOAA
─────────────────────────────────────────────────────
                       WebGL
```

## Runtime ownership

```text
SvelteKit
    ↓
AeroWindow              (Svelte 5 orchestration + reactive state)
    ↓
CesiumViewer.svelte      (the ONLY place `new Cesium.Viewer()` is called)
    ↓
Viewer
    ↓
Scene
    ↓
GPU
```

Only one object owns the Viewer. Everything else consumes it.

## Responsibilities

| Concern | Owns | Never |
|---|---|---|
| **Model** | application state | renders |
| **World** | Earth (Cesium primitives) | decides where to fly |
| **Camera** | movement (camera pose) | anything visual |
| **Flight** | behaviour (location, weather, time) | renders |
| **Scene** | decorative effects | touches Cesium globe primitives |
| **Shell** | presentation (DOM chrome) | reads simulation |

## Data flow

```text
Settings UI
    ↓
$config                    (rune)
    ↓
$derived                    (e.g. lightingState)
    ↓
$effect                      (only Cesium sync)
    ↓
Cesium Scene / PostProcess  (the external system)
    ↓
GPU
```

The Svelte team's recommendation is to **prefer `$derived` for computed
values rather than `$effect`** (Svelte 5 docs). We follow that strictly:
computation lives in `$derived`, `$effect` is reserved for pushing values
into Cesium.

## The Single-Viewer Rule

Exactly **one** Cesium `Viewer` per process. No other file in the
codebase calls `new CesiumModule.Viewer(...)`.

**Why:**
- GPU memory predictability (a second Viewer doubles the budget)
- No shared render context to reason about
- Cesium's tile streaming + post-process pipelines are not designed
  to share state across viewers

**If you think you need a second canvas** (a tiny preview in the admin
panel, for example): that's a signal you should be designing a
*different* pattern — a screenshot pipeline, a Cesium DataSource, or
a custom render-target — not a second Viewer.

The invariant is enforced by convention. The single call site is
`src/lib/world/CesiumViewer.svelte` and it's documented in that file's
header comment.

## Reactive feature pattern

```ts
// 1. Mutable state (rune, in $state)
export const config = $state({
	terrain: 'copernicus',
	bloom: true,
	hdr: true,
	weather: 'clear',
	quality: 'balanced',
});

// 2. Computed (rune, in $derived)
export const lighting = $derived(computeLighting(clock.utc));
export const nightMix = $derived(lighting.nightMix);

// 3. Synchronisation (rune, in $effect — only Cesium sync)
$effect(() => {
	viewer.scene.fog.density = lighting.fogDensity;
});

$effect(() => {
	viewer.scene.globe.enableLighting = config.enableLighting;
});
```

Three rules:
- **`$state`** — only actual application state.
- **`$derived`** — every computation; never compute inside `$effect`.
- **`$effect`** — push rune values into Cesium; never compute.

## Manager → feature migration map

| Old | New | Phase |
|---|---|---|
| `world/lightning-stage.ts` | `world/effects/lightning.svelte.ts` | **1** [shipped] |
| `world/cloud-billboard-layer.ts` | `world/effects/clouds.svelte.ts` | **1** [shipped] |
| (color-grade in `compose.ts`) | `world/effects/color-grade.svelte.ts` | **1** [shipped] |

> Phase 1 shipped: lightning, clouds, color-grade are now reactive
> features in `world/effects/`. The legacy imperative classes
> (`LightningStage`, `CloudBillboardLayer`, inline color-grade block
> in `compose.ts`) are still present alongside the new modules and
> still receive the same sync calls — they will be removed in Phase 2
> once all four async-setup subsystems migrate together.
| `world/imagery.ts` | `world/imagery.ts` (hybrid) | 2 |
| `world/buildings.ts` | `world/buildings.ts` (hybrid) | 2 |
| `world/atmosphere-manager.ts` | `world/atmosphere.svelte.ts` (hybrid) | 2 |
| `world/terrain-manager.ts` | `world/terrain.ts` (hybrid) | 2 |
| `world/camera-manager.ts` | `world/camera.svelte.ts` | 3 |
| `world/compose.ts` | (kept, slimmed) | 4 |

**Hybrid** = class for async setup (Ion token, terrain provider, 3D
Tiles init), `$effect` for per-frame sync. Async I/O does not fit
the `$effect` model cleanly — setup runs once, sync runs reactively.

## Three.js overlay

The overlay (in `src/lib/world/three/`) holds **only** what Cesium
genuinely can't do:
- **Wing** — camera-anchored SWA 737 GLB with yaw-stripped
  positioning for 3-Pi panorama continuity
- **Clouds** — PNG-sprite cluster composition at the cloud deck
  (artistic CSS3D-style reads that don't match Cesium's BillboardCollection aesthetic)

Cesium handles everything else natively: stars, sun, moon, bloom,
tonemap, lightning post-process, building OSM tiles, VIIRS night
lights. The Three overlay is not another engine; it's a thin canvas
consumer that mirrors the Cesium camera each frame.

## Non-goals

- **`applyConfigPatch` is not removed.** It's the single write gate for
  the fleet CRDT LWW merge (concurrent-admin-write safety) and the
  prototype-pollution defense (`__proto__`/`constructor`/`prototype`
  rejection). Direct `$state` mutation would break both. The function
  is a deliberate trade-off in favor of safety, not against runes.
- **ECS is not adopted.** The product has one entity (the display).
  There is no second entity to justify the pattern. We use manager-
  per-Cesium-primitive (the MRAX "Actions layer") instead.
- **The Flight Engine stays imperative.** Simulation is time-driven,
  not state-driven. Wrapping flight in `$effect` would produce visible
  jitter across reactive frames; an imperative `tick(dt)` is correct.