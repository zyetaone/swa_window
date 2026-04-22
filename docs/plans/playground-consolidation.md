# Implementation Plan: Playground Consolidation
# /playground → Single Composited Image with Toggleable Layer Stack

**Date:** 2026-04-22
**Branch:** playground/maplibre-app
**Status:** SUPERSEDED (2026-04-23)

> ⚠ **SUPERSEDED — DO NOT EXECUTE.** This plan envisioned a MapLibre + Three.js
> scene lab with a layer-stack UI. It was partially executed over the
> 2026-04-22/23 sessions, then reversed on the user's direction: `/playground`
> is now a lean **Cesium** scene lab that mirrors production `/`'s rendering
> pipeline. The Threlte + takram atmosphere stack was removed; CSS3D sprite
> clouds (`ArtsyClouds.svelte` in `$lib/atmosphere/clouds/`) became the
> canonical cloud renderer on both routes. Final resting point: phase 8b,
> commit `970c146`. See `CLAUDE.md` → Phase history. Kept in-tree as a
> process artifact.

---

## 1. Current-State Audit

### What /playground Has Today

| Concern | File | Notes |
|---------|------|-------|
| Scene root | `src/routes/playground/+page.svelte` (819 lines) | Motion RAF, corridor WS, blind, long-press boost, palette bar, drawer toggle |
| Globe | `MapLibreGlobe.svelte` (217 lines) | MapLibre host; delegates to 7 sub-layer components |
| Sky + atmosphere | `AtmosphereLayer.svelte` (104 lines) | MapLibre `<Sky>`, `<Light>`, GlobeControl, topo-grid, ground fog, cloud shadows. **BUG**: topo-grid/fog rendered before terrain, hidden by it |
| Terrain/hillshade | `TerrainLayer.svelte` (43 lines) | Mapterhorn DEM + HillshadeLayer |
| Water | `WaterLayer.svelte` (73 lines) | MapLibre FillLayer + LineLayer (vector tile shimmer + night glow) |
| Buildings | `BuildingLayer.svelte` (57 lines) | MapLibre FillExtrusionLayer, warm amber at night |
| City lights + roads | `CityLightsLayer.svelte` (141 lines) | Night-only: road-glow, traffic core, red spark, corona, city-glow (animated flicker in parent) |
| VIIRS night | `NightLayers.svelte` (78 lines) | CartoDB dark raster at `nightFactor * 0.32` opacity |
| Landmarks | `LandmarkLayer.svelte` (65 lines) | GeoJSON circles per location |
| Terrain GeoJSON filters | `TerrainFilters.svelte` (78 lines) | Newly separated: topo-grid, fog, cloud shadows (correct depth order) |
| Sky atmosphere rim | `HorizonAtmosphere.svelte` (34 lines) | Standalone `<Sky>` — low `atmosphere-blend` for globe-limb scatter only |
| Three.js clouds | `SkyCloudsLayer.svelte` (~200 lines) | CustomLayer: PNG sprite sandwich at world lat/lon, location-seeded PRNG |
| CSS 3D clouds | `CSS3DClouds.svelte` (~400 lines) | Spite technique — PNG sprites in CSS 3D space, overlay position |
| Night/celestial | `NightOverlay.svelte` (~280 lines) | Stars, moon, lens flare, dawn/dusk haze, atmo overlay — CSS only |
| Post-process | `three/PostProcessMount.svelte` (unknown, unread) | Three.js: UnrealBloom → WaterPass → OutputPass — reads MapLibre canvas each frame |
| Water GLSL | `three/shaders/water.glsl` (225 lines) | Chroma-key mask, scrolling normals, Fresnel, sun specular |
| Scene state | `lib/playground-state.svelte.ts` (249 lines) | `pg` flat `$state` — location, time, weather, clouds, orbit, corridor role |
| Sky phase SSOT | `lib/sky-phase.ts` (187 lines) | 6 phases × PhaseConfig — gradient, sun/moon colors, bloom, city tint |
| Corridor sync | `lib/corridor.svelte.ts` (unread) | Role/groupId binding, headingOffset, isGroupLeader |
| Camera reactive | `lib/globe-camera.svelte.ts` | Syncs lat/lon/pitch/bearing into MapLibre |
| Filters reactive | `lib/globe-filters.svelte.ts` | Applies nightFactor CSS filters to MapLibre canvas |

### What /playground2 Proved (Assumed from session memory + task description)

| Finding | Implication |
|---------|-------------|
| MapScene CustomLayer pattern: one Three.js scene mounted inside MapLibre's WebGL context | Unifies all Three.js rendering under one render pass instead of two separate WebGL contexts |
| `SceneCell.svelte` / `MapLibreCell.svelte`: 6-cell grid visualization | Grid itself is lab-only; the per-cell isolation discipline transfers |
| `layers/buildings.ts` module pattern: feature-class as pure data module (GeoJSON → mesh params) | Decouples data prep from render — cleanly testable |
| `MercatorCoordinate.fromLngLat` → Three.js mesh position pipeline | `SkyCloudsLayer.svelte` lines 92-95 already proves this works in prod |
| Three.js `Earcut` + `BufferGeometry` for GeoJSON polygon → extruded mesh | Proven approach for replacing MapLibre `fill-extrusion` with custom ShaderMaterial |
| Sky-above-horizon compositing: CSS gradient behind transparent MapLibre canvas | Already in prod: `+page.svelte` `bgGradient` → `.viewport-btn` background |
| Per-feature ShaderMaterial: water, land, buildings each get own GLSL | Water already has `water.glsl`; buildings and land need new shaders |

---

## 2. Target Architecture

### Component Tree (Target)

```
src/routes/playground/
├── +page.svelte                   (KEEP — trimmed, wires layer-stack state)
│   ├── <NightOverlay>             (KEEP — CSS celestial + haze overlay)
│   ├── <CSS3DClouds>              (KEEP — foreground volumetric sprites)
│   ├── blind, long-press, corridor sync, RAF loop  (KEEP unchanged)
│   └── <MapLibreGlobe>            (KEEP — host, receives layerStack prop)
│       ├── <HorizonAtmosphere>    (KEEP — MapLibre Sky rim glow)
│       ├── <TerrainLayer>         (KEEP — DEM + hillshade)
│       ├── <TerrainFilters>       (KEEP — topo-grid, fog, cloud-shadows)
│       ├── <NightLayers>          (KEEP — CartoDB ambient raster)
│       ├── <WaterLayer>           (KEEP — MapLibre FillLayer: data source)
│       ├── <BuildingLayer>        (KEEP initially → Phase 3 migrates to Three.js)
│       ├── <CityLightsLayer>      (KEEP — road-glow, city-corona, city-glow)
│       ├── <LandmarkLayer>        (KEEP)
│       └── <MapScene>             (NEW Phase 1 — single Three.js CustomLayer)
│           ├── <WaterMesh>        (NEW Phase 2 — Three.js water plane + water.glsl)
│           ├── <LandMesh>         (NEW Phase 2 — GeoJSON land polygon → mesh)
│           ├── <BuildingsMesh>    (NEW Phase 3 — replaces fill-extrusion)
│           └── <SkyCloudsLayer>   (MOVE Phase 1 — currently a sibling, becomes child)
│
├── lib/
│   ├── playground-state.svelte.ts (EXTEND — add layerStack array)
│   ├── layer-stack.ts             (NEW Phase 4 — types + default stack order)
│   └── [existing lib files]       (KEEP)
│
└── components/
    ├── PlaygroundDrawer.svelte    (EXTEND Phase 4 — add LayerStack panel section)
    └── [existing components]      (KEEP)
```

### Data Flow Diagram

```
pg (playground-state, $state module singleton)
  │
  ├─[layerStack] ─────────────────────────────────────────────────────────────┐
  │   Array<LayerEntry>: id, visible, opacity, preset                          │
  │   Broadcast via fleet WS as config_patch on any change                    │
  │                                                                             ▼
  │                                            PlaygroundDrawer → LayerStack UI
  │
  ├─[nightFactor, timeOfDay, weather, etc.]
  │   ▼
  │  +page.svelte RAF loop
  │   ├─ pgTick() → orbit position, altitude, heading
  │   ├─ motion.tick() → turbulence/bank/breathing
  │   └─ corridor broadcast (leader only)
  │
  ├─ MapLibreGlobe props (lat, lon, pitch, bearing, nightFactor, ...)
  │   ▼
  │   MapLibreGlobe
  │   ├─ globeCamera.$effect → map.jumpTo() / map.easeTo()
  │   ├─ globeFilters.$effect → map CSS filter (nightFactor color-grade)
  │   └─ Layer components (AtmosphereLayer, WaterLayer, etc.) — no change
  │       └─ MapScene (NEW)
  │           ├─ THREE.WebGLRenderer shared with MapLibre (CustomLayer context)
  │           ├─ WaterMesh ← layerStack['water'].{visible, opacity, preset}
  │           ├─ LandMesh  ← layerStack['land'].{visible, opacity, preset}
  │           └─ BuildingsMesh ← layerStack['buildings'].{visible, opacity, preset}
  │
  └─ PostProcessMount (KEEP — bloom + WaterPass screen-space post)
      reads MapLibre canvas after MapScene renders
      water.glsl still drives the final water look (chroma-key → scroll normals)
```

### What Dies

| Component | Reason | When |
|-----------|--------|------|
| `AtmosphereLayer.svelte` topo-grid/fog/shadow blocks | Moved to `TerrainFilters.svelte` (already exists) | Already split — just remove from AtmosphereLayer |
| `BuildingLayer.svelte` | Replaced by `BuildingsMesh` (Three.js extruded mesh) | Phase 3 |
| `SkyCloudsLayer.svelte` (current top-level position) | Moved inside `MapScene` as a scene child | Phase 1 |
| PostProcessMount water chroma-key dependency | WaterMesh provides a proper geometry mask — chroma-key becomes fallback | Phase 2 |

### What Stays

Everything else in `/playground` is preserved untouched. The CSS 3D cloud overlay, blind, motion engine, corridor sync, NightOverlay, and the entire `/playground2` route (read-only reference) are never touched by this plan.

---

## 3. Migration Phases

### Phase 1: MapScene Scaffold — Replace Ad-hoc Three.js Mount

**Scope:**
- `src/routes/playground/layers/MapScene.svelte` (NEW ~120 lines)
- `src/routes/playground/MapLibreGlobe.svelte` (EDIT — add `<MapScene>` child, remove SkyCloudsLayer from top-level)
- `src/routes/playground/layers/SkyCloudsLayer.svelte` (MOVE — becomes child of MapScene)
- `src/routes/playground/+page.svelte` (EDIT — remove `<PostProcessMount map={mapRef}>` temp bridge if MapScene takes over context ownership)

**What it does:**
MapScene is a single `<CustomLayer>` that holds the Three.js `Scene`, `Camera`, and `WebGLRenderer` shared from MapLibre's GL context. All Three.js rendering in the playground runs inside one render pass. `SkyCloudsLayer` moves from being a sibling `<CustomLayer>` to a child that registers its meshes into MapScene's shared scene graph.

**Files touched:** 3
**Effort:** half-day
**Success criteria:**
- `bun run check` passes, no TypeScript errors
- Chrome: sky cloud sprites still visible at the horizon (behavioral parity)
- No second WebGL context created (verify in DevTools → WebGL contexts)
- `PostProcessMount` still reads the composite frame correctly post-render

**Risk flags:**
- `SkyCloudsLayer` currently owns its own `scene` and `camera` instances (lines 31-33 of SkyCloudsLayer). Migration requires delegating these to MapScene. If MapLibre's matrix injection differs between a standalone CustomLayer and a nested one, sprites will misplace.
- MapScene must call `map.triggerRepaint()` if any child requests a redraw — consolidate the repaint call.

**Kill criteria:**
- If cloud sprites can't be positioned correctly inside a shared scene, keep SkyCloudsLayer as its own CustomLayer and have MapScene coexist as a separate layer below it. Sprite clouds are more visually important than architecture cleanliness.

---

### Phase 2: WaterMesh + LandMesh — Feature-Class Shaders

**Scope:**
- `src/routes/playground/layers/WaterMesh.svelte` (NEW ~150 lines)
- `src/routes/playground/layers/LandMesh.svelte` (NEW ~100 lines)
- `src/routes/playground/lib/geo-mesh.ts` (NEW ~80 lines — GeoJSON → Earcut → BufferGeometry helper)
- `src/routes/playground/layers/MapScene.svelte` (EDIT — mount WaterMesh, LandMesh)
- `src/routes/playground/three/shaders/water.glsl` (KEEP unchanged — still used by PostProcessMount for screen-space pass)

**What it does:**
`WaterMesh` uses `map.querySourceFeatures('openmaptiles', { sourceLayer: 'water' })` to get GeoJSON polygons, triangulates them via `THREE.ShapeUtils.triangulateShape()` (which calls Earcut internally — no new dep), converts vertices to MercatorCoordinate world units, and uploads a `BufferGeometry` with a `ShaderMaterial` that drives scrolling normals + Fresnel directly on the mesh (not in screen-space). This gives the water a *geometry mask* for the PostProcessMount WaterPass, which currently relies on chroma-key. The chroma-key remains as a safety fallback but `WaterMesh` geometry is authoritative.

`LandMesh` does the same for `landcover` / `landuse` polygons — adds per-biome color + nightFactor dimming so the terrain reads warmer than the default EOX raster.

`geo-mesh.ts` is the shared GeoJSON → mesh helper used by both. Exports:
```typescript
export function buildFlatMesh(
  features: GeoJSON.Feature[],
  altitudeM: number,
  map: maplibregl.Map
): THREE.BufferGeometry
```

**Files touched:** 5
**Effort:** 1 day
**Success criteria:**
- Water polygons visible as Three.js geometry with scrolling normals at zoom 6+
- `bun run check` passes
- Chrome: LandMesh biome coloring visible (greenery, desert, etc.)
- PostProcessMount water pass still works — confirm coast shimmer present
- No frame rate regression on Pi-class hardware (target: >= 25 fps)

**Risk flags:**
- `querySourceFeatures` returns only *loaded* tiles — if camera is zoomed out, many tiles absent. Need a minimum zoom gate (zoom >= 5) before building meshes.
- Earcut triangulation fails on self-intersecting polygons in OpenFreeMap data. Add a try/catch per feature and skip degenerate polys.
- Memory: BufferGeometry must be disposed and rebuilt on location change. Track meshes in a ref and call `.dispose()` before replacing.

**Kill criteria:**
- If geometry mesh costs more GPU than the MapLibre FillLayer it replaces (measure with Chrome GPU Timeline), revert WaterMesh and keep the screen-space PostProcessMount chroma-key as the sole water technique.

---

### Phase 3: BuildingsMesh — Three.js Extruded Buildings

**Scope:**
- `src/routes/playground/layers/BuildingsMesh.svelte` (NEW ~200 lines)
- `src/routes/playground/three/shaders/buildings.glsl` (NEW ~60 lines)
- `src/routes/playground/layers/BuildingLayer.svelte` (DEPRECATE — visibility gated by `pg.layerStack['buildings'].visible`)
- `src/routes/playground/layers/MapScene.svelte` (EDIT — mount BuildingsMesh)

**What it does:**
Replaces `BuildingLayer.svelte`'s `fill-extrusion` with Three.js extruded geometry. Pipeline:
1. `map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' })` → polygons with `render_height` property
2. Per-polygon: base ring → `THREE.Shape` → `.extrude({ depth: render_height })` → `ExtrudeGeometry`
3. Merge all per-building geometries into one `BufferGeometry` (one draw call)
4. `buildings.glsl`: height-based warm amber at night, cool grey by day, `nightFactor` uniform

`BuildingLayer.svelte` is kept as an import but conditionally rendered only when `!pg.layerStack['buildings'].threeEnabled` — allows A/B toggle during development and a clean rollback.

**Files touched:** 4
**Effort:** 1.5 days
**Success criteria:**
- Buildings visible at zoom >= 13, height-proportional geometry
- `bun run check` passes
- Chrome: night amber glow on tall buildings matches prior fill-extrusion look
- Side-by-side DevTools screenshot comparison: Three.js mesh vs fill-extrusion — height accuracy within visual tolerance
- BuildingLayer fallback still works when `threeEnabled = false`

**Risk flags:**
- Extruded geometry count: a dense city at z14 can produce 2000+ buildings. Merge geometry by chunk (100 buildings per BufferGeometry) to stay within 65535 index limit for Uint16 index buffers. Use `Uint32Array` for index buffers if merging further.
- `ExtrudeGeometry` has no roof UVs suitable for window textures — accept flat color only for v1. Window emissive texture is a Phase 5+ concern.
- Rebuild on camera move is expensive. Cache by tile hash; only rebuild tiles that enter/leave the view.
- **Architectural invariant check**: BuildingsMesh lives in `src/routes/playground/layers/` — NOT in `src/lib/`. It imports Three.js directly. Cesium isolation invariant is not affected (we never import cesium here). ✓

**Kill criteria:**
- If merged geometry produces visible z-fighting with MapLibre's native fill-extrusion at certain zoom levels, keep `BuildingLayer.svelte` as the sole renderer and skip the Three.js extrusion.

---

### Phase 4: Layer Stack UI + State Wiring

**Scope:**
- `src/routes/playground/lib/playground-state.svelte.ts` (EDIT — add `layerStack`)
- `src/routes/playground/lib/layer-stack.ts` (NEW ~60 lines — types, defaults, helpers)
- `src/routes/playground/components/PlaygroundDrawer.svelte` (EDIT — add LayerStack section)
- `src/routes/playground/+page.svelte` (EDIT — wire corridor broadcast for layer changes)

**What it does:**
Adds a Photoshop-style layer stack control to the existing drawer. Each layer entry drives a prop on its consumer component (`visible`, `opacity`, `preset`). The stack is part of `pg` so it participates in the corridor `config_patch` broadcast.

See Section 4 for the UI mockup and Section 5 for the state shape.

**Files touched:** 4
**Effort:** 1 day
**Success criteria:**
- `bun run check` passes
- Chrome: toggling a layer hides/shows it without page reload
- Opacity slider on water layer visually changes water transparency
- Drawer renders the layer stack below existing Layers fieldset
- Corridor: changing a layer on the leader pane applies to follower panes within 2.5s

**Risk flags:**
- Flat DTO boundary invariant (CLAUDE.md §2): `layerStack` must be serializable as a flat array of primitives. No nested objects beyond one level. Each entry: `{ id, visible, opacity, preset }` — all primitives. ✓
- Layer order reordering changes z-index — MapLibre layers are ordered by insertion, not a live z property. If reorder is implemented, it must call `map.moveLayer()`. Defer drag-reorder to Phase 5; v1 has fixed order with visibility/opacity only.

**Kill criteria:**
- If adding `layerStack` to `pg` causes fleet protocol breakage (existing v1 messages now carry unknown fields), move `layerStack` to a separate `pgLayers` module-level `$state` object that is NOT part of the WS broadcast. Layer sync can be added as a v2 `config_patch` path without polluting v1.

---

### Phase 5: Deprecate /playground2

**Scope:**
- `src/routes/playground2/` (READ-ONLY — no changes, archive as reference)
- `docs/CODEMAPS/files.md` (EDIT — mark playground2 as lab/reference)
- `src/routes/playground2/+page.svelte` (OPTIONAL — add banner "Lab reference — see /playground for production")

**What it does:**
Playground2 served its purpose: it proved the MapScene pattern, per-feature shader architecture, and sky compositing in an isolated 6-cell lab. With Phase 1-4 complete, all proven patterns live in /playground. Playground2 is retained as a read-only reference, not deleted, in case we need to compare approaches.

**Files touched:** 1-2
**Effort:** 1 hour
**Success criteria:**
- `/playground2` still loads and renders (not broken)
- CODEMAPS notes it as reference/archived
- No broken imports or dead exports

**Risk flags:** None — no source changes.

---

## 4. Layer Stack UI Design

```
┌─────────────────────────────────────────────────────────┐
│  LAYERS                                                  │
│  ─────────────────────────────────────────────────────── │
│                                                          │
│  ↕  ○ Sky + Atmosphere     [auto     ▼]  ████████░░ 85% │
│  ↕  ● Clouds (CSS 3D)      [storm    ▼]  ██████████ 100%│
│  ↕  ● Night Overlay        [auto     ▼]  ███░░░░░░░ 35% │
│  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  (divider) │
│  ↕  ● Water                [fresnel  ▼]  ██████░░░░ 65% │
│  ↕  ● Land                 [biome    ▼]  █████░░░░░ 55% │
│  ↕  ○ Buildings            [amber    ▼]  ████████░░ 80% │
│  ↕  ● Roads / City Lights  [night    ▼]  ███████░░░ 75% │
│  ↕  ● Terrain + Hillshade  [default  ▼]  ██████████ 100%│
│  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  ─  (divider) │
│  ↕  ● Landmarks            [default  ▼]  ████░░░░░░ 45% │
│                                                          │
│  [Save preset]  [Load preset]  [Reset to defaults]      │
└─────────────────────────────────────────────────────────┘

Legend:
  ↕  = drag handle (Phase 5+ — deferred)
  ●  = visible (filled circle toggle)
  ○  = hidden (hollow circle toggle)
  [preset ▼] = shader preset dropdown
  ████░░  = opacity bar (click+drag or click to open slider)
```

**Interaction notes:**
- Clicking the circle icon toggles `visible`. Immediate visual feedback.
- Opacity bar: click anywhere on it to open an inline `<input type=range>`. Closes on blur.
- Preset dropdown: the options shown depend on which layer it is (water: fresnel/flat/night; buildings: amber/grey/wireframe; etc.).
- "Save preset" writes `pg.layerStack` snapshot to `localStorage['aero.layerPreset']`. "Load preset" reads it back.
- The stack section sits BELOW the existing "Layers" fieldset in `PlaygroundDrawer.svelte`, replacing the existing per-checkbox layer list once Phase 4 is complete.

---

## 5. State Shape

### Extension to `playground-state.svelte.ts`

```typescript
// src/routes/playground/lib/layer-stack.ts (NEW)

export type LayerId =
  | 'sky'
  | 'clouds-css3d'
  | 'night-overlay'
  | 'water'
  | 'land'
  | 'buildings'
  | 'city-lights'
  | 'terrain'
  | 'landmarks';

export type LayerPreset = string; // open-ended — each layer defines its own

export interface LayerEntry {
  id: LayerId;
  visible: boolean;
  opacity: number;    // 0..1
  preset: LayerPreset;
}

export const DEFAULT_LAYER_STACK: LayerEntry[] = [
  { id: 'sky',          visible: true,  opacity: 1.0, preset: 'auto'    },
  { id: 'clouds-css3d', visible: true,  opacity: 1.0, preset: 'auto'    },
  { id: 'night-overlay',visible: true,  opacity: 1.0, preset: 'auto'    },
  { id: 'water',        visible: true,  opacity: 0.9, preset: 'fresnel'  },
  { id: 'land',         visible: true,  opacity: 0.7, preset: 'biome'   },
  { id: 'buildings',    visible: false, opacity: 0.9, preset: 'amber'   },
  { id: 'city-lights',  visible: true,  opacity: 0.9, preset: 'night'   },
  { id: 'terrain',      visible: true,  opacity: 1.0, preset: 'default' },
  { id: 'landmarks',    visible: true,  opacity: 0.6, preset: 'default' },
];

export function getLayer(stack: LayerEntry[], id: LayerId): LayerEntry {
  return stack.find(e => e.id === id) ?? DEFAULT_LAYER_STACK.find(e => e.id === id)!;
}
```

### Additions to `pg` in `playground-state.svelte.ts`

```typescript
// Add to the existing pg = $state({...}) object:

layerStack: DEFAULT_LAYER_STACK as LayerEntry[],
```

`DEFAULT_LAYER_STACK` is imported from `layer-stack.ts`. No nested objects beyond one level — each `LayerEntry` contains only primitives. Satisfies the flat DTO boundary invariant.

### Corridor Fleet Sync for Layer Changes

Layer changes broadcast as a v2 `config_patch`:

```typescript
// In +page.svelte — watch layerStack mutations
$effect(() => {
  const stack = pg.layerStack;
  if (!isGroupLeader(pg.role)) return;
  untrack(() => {
    const ws = fleetWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      v: 2,
      type: 'config_patch',
      path: 'playground.layerStack',
      value: stack,
    }));
  });
});
```

**Follower handling:** The existing `ws.onmessage` handler in `+page.svelte` already routes `config_patch` messages. Add one case:
```typescript
if (parsed.type === 'config_patch' && parsed.path === 'playground.layerStack') {
  pg.layerStack = parsed.value as LayerEntry[];
}
```

**Important:** Layer stack changes are NOT time-critical (unlike `director_decision` which needs wall-clock sync). They apply immediately on receipt — no `transitionAtMs` needed. Followers will see a ~50–200ms lag, which is imperceptible for a layer visibility toggle.

---

## 6. Open Questions

### Q1: Per-location layer presets — should they exist?
The current architecture has `pg.activeLocation` drive the camera but not the visual style. Should switching from Dubai (clear, amber-lit city) to Himalayas (no city lights, terrain-dominant) automatically change the layer stack? This implies a `LOCATION_LAYER_PRESETS` map analogous to `LOCATION_MAP`. Decision needed before Phase 4 to know whether the LayerEntry shape needs a `locationOverride` field.

**Tentative answer:** No auto-switching in v1. Manual only. The autopilot already adjusts weather + turbulence; adding auto-layer-presets is a Phase 6+ feature.

### Q2: Is the layer stack per-device or fleet-wide?
Currently proposed as fleet-wide (broadcast via config_patch). But for a 6-Pi corridor, each pane might want different opacity on water (left/right panes see more ocean than the center, potentially). Should the layer stack be:
- (a) Fleet-wide — same on all panes (simpler, current proposal)
- (b) Per-role — `left`, `center`, `right` each get a different stack snapshot
- (c) Per-device — each Pi manages its own stack (no sync)

**Decision needed:** Option (a) is safe for v1. Option (b) is the right long-term answer for a corridor that clips a continuous panorama.

### Q3: WaterMesh geometry mask vs chroma-key — which is authoritative?
`water.glsl` in `PostProcessMount` uses a chroma-key to detect water pixels. If `WaterMesh` (Phase 2) introduces a geometry-based mask, we have two water effects running:
- MapLibre FillLayer (vector tile fill — provides the base color)
- WaterMesh geometry (Three.js mesh in MapScene — owns scrolling normals)
- PostProcessMount water.glsl (screen-space — existing chroma-key sheen)

Do we run all three, or retire PostProcessMount's water pass once WaterMesh lands? Running all three risks double-shimmer artifacts. Recommendation: gate PostProcessMount's `waterIntensity` uniform to 0 when `pg.layerStack['water'].preset === 'fresnel'` (Three.js mesh handles it) and restore it for `preset: 'screen-space'`.

### Q4: BuildingsMesh tile-rebuild strategy — event vs polling?
Rebuilding extruded geometry on every camera move is too expensive. Options:
- Listen to MapLibre `'data'` event (fires on tile load) — rebuilds when new tiles arrive
- Poll on a timer (e.g. every 3s) — simpler but laggy
- `map.querySourceFeatures` returns empty until tiles are loaded — the event approach avoids the empty-set problem

No research spike needed; the `'data'` event approach is standard MapLibre practice. Flag: confirm the event still fires on the `openmaptiles` vector source specifically (some sources use `tiledata` instead of `data`).

### Q5: Does `SkyCloudsLayer` NEED to move inside MapScene?
`SkyCloudsLayer` is already a working CustomLayer with its own Three.js context. Phase 1 proposes merging it into MapScene. The benefit: one GL context, one render pass. The risk: sprite depth sorting with other MapScene geometry (water, land) may produce z-fighting.

If the z-fighting is unresolvable (cloud sprites appear behind water at the horizon), keeping `SkyCloudsLayer` as a separate CustomLayer above MapScene is acceptable — the two CustomLayers share MapLibre's GL context by design, and MapLibre serializes their `render()` calls.

---

## 7. Risk Register

### R1: Geometry rebuild stalls the frame
**Signal:** BuildingsMesh or WaterMesh triggers a full geometry rebuild mid-frame, causing a visible hitch (1-3 dropped frames).
**Mitigation:** Rebuild off the critical path — use `requestIdleCallback` or a `setTimeout(0)` deferral. Build geometry incrementally (one tile per frame) rather than all at once.
**Rollback:** Re-enable `BuildingLayer.svelte` fill-extrusion via `threeEnabled = false` flag. WaterMesh: set `waterIntensity = 0` to fall back to chroma-key sheen.

### R2: Pi 5 GPU bottleneck
**Signal:** FPS drops below 25 on Pi 5 Chromium (`--use-gl=angle --use-angle=gles`) with Three.js geometry + MapLibre + PostProcessMount all running.
**Mitigation:** Phase 2 success criteria includes a Pi-class FPS gate (>= 25 fps). Measure before and after WaterMesh with Chrome DevTools GPU Timeline. If geometry is the bottleneck, reduce poly count (simplify GeoJSON with `turf.simplify` before triangulation).
**Rollback:** Each phase is independently revertable. Phase 2 and 3 meshes are gated by `layerStack[*].visible` — setting to false disables GPU work without code changes.

### R3: MapScene CustomLayer breaks MapLibre's projection pipeline
**Signal:** MapLibre terrain or fill-extrusion layers render with wrong depth against MapScene meshes. Or `calculateFogMatrix` warnings (already seen with HeatmapLayer on globe projection — now resolved by using CircleLayer).
**Mitigation:** CustomLayer must implement `renderingMode: '3d'` and use the `projectionData` matrix from `CustomLayerInterface.render(gl, options)`. `SkyCloudsLayer` already does this correctly (lines 92-95 use `MercatorCoordinate` → world units). Replicate that pattern exactly in MapScene.
**Rollback:** Remove `<MapScene>` from `MapLibreGlobe.svelte`. `SkyCloudsLayer` reverts to a sibling CustomLayer (its pre-Phase-1 position).

### R4: Corridor sync of layerStack diverges from prod fleet protocol
**Signal:** Admin panel shows stale layer config on follower devices; or v1 fleet messages start carrying `layerStack` noise.
**Mitigation:** `layerStack` patch is sent as a v2 `config_patch` with path `playground.layerStack`. The prod fleet hub (in `src/lib/fleet/hub.ts`) routes v2 messages by `groupId` — playground-only devices use a distinct `groupId` ('playground') so the patch never reaches production Pi kiosk devices. Confirm `groupId` isolation is enforced before Phase 4.
**Rollback:** Remove the `$effect` that broadcasts `layerStack`. Followers stay at their local defaults. No functional breakage — just no sync.

### R5: Half-migrated state — /playground partially uses Three.js meshes
**Signal:** Phase 2 lands but Phase 3 is blocked; BuildingLayer (fill-extrusion) and WaterMesh (Three.js) run side-by-side indefinitely. Water shimmer looks different from building shader → visual inconsistency.
**Mitigation:** Each phase has its own visual success criteria and a `threeEnabled` gate so the old MapLibre layer can be restored if the Three.js replacement isn't ready. The two systems can coexist without interfering — they use different source layers.
**Rollback:** Not needed — coexistence is intentional during migration. Only post-Phase-3 do we fully commit to Three.js for water+land+buildings.

---

## Dependency Map

```
Phase 1 (MapScene scaffold)
  │ hard depends on → nothing (additive)
  │ blocks → Phase 2, Phase 3 (MapScene is the container)
  └─ parallel with → Phase 4 state design (can design layer-stack.ts while Phase 1 codes)

Phase 2 (WaterMesh + LandMesh)
  │ hard depends on → Phase 1 (MapScene container exists)
  │ soft depends on → Phase 4 layer-stack.ts types (needs LayerEntry type for opacity/preset props)
  └─ blocks → Phase 3 indirectly (geo-mesh.ts helper reused)

Phase 3 (BuildingsMesh)
  │ hard depends on → Phase 1 (MapScene), Phase 2 (geo-mesh.ts helper)
  │ soft depends on → Phase 4 (layer visibility gate)
  └─ parallel with → Phase 4 UI (UI can be wired before Phase 3 merges)

Phase 4 (Layer Stack UI)
  │ hard depends on → nothing (state shape is additive, UI is additive)
  │ soft depends on → Phase 2+3 (preset dropdowns only meaningful once meshes exist)
  └─ blocks → Phase 5 (must confirm state shape stable)

Phase 5 (Deprecate playground2)
  └─ hard depends on → Phase 4 complete
```

---

## Estimation Summary

| Phase | Effort | Risk |
|-------|--------|------|
| 1 — MapScene scaffold | half-day (S) | Medium (CustomLayer matrix) |
| 2 — WaterMesh + LandMesh | 1 day (M) | Medium (Earcut + rebuild cost) |
| 3 — BuildingsMesh | 1.5 days (M) | Medium (index buffer limits, z-fight) |
| 4 — Layer Stack UI + state | 1 day (M) | Low |
| 5 — Deprecate playground2 | 1 hour (XS) | None |
| **Total** | **~4.5 days** | |

---

## Verification Checklist (All Phases Done)

- [ ] `bun run check` passes (zero TypeScript errors)
- [ ] `bun x vitest run` passes (104 tests, no regressions)
- [ ] `bun run build` succeeds (single-bundle, no chunk-size warnings)
- [ ] Chrome `/playground`: scrolling water normals visible on ocean pixels
- [ ] Chrome `/playground`: Three.js buildings visible at zoom 13+ with amber night glow
- [ ] Chrome `/playground`: layer stack UI in drawer with toggle, opacity, preset
- [ ] Chrome: corridor — change location on `?role=center` → follower pane updates within 2.5s
- [ ] Chrome: layer toggle on leader → follower pane hides/shows layer within 200ms
- [ ] Pi 5 physical device: FPS >= 25 with all layers visible
- [ ] `/playground2` still loads without errors (unmodified reference)
- [ ] No Cesium imports outside `src/lib/world/` (`rg "from 'cesium'" src/lib/` → 2 hits only)
