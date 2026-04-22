# Design: Volumetric Clouds + Architecture Page Enhancements

**Date**: 2026-02-18
**Status**: Approved

## Three Deliverables

### 1. Favicon Fix

- Replace default Svelte SVG favicon with custom airplane-window icon
- Place `favicon.svg` in `static/`
- Add `<link rel="icon" href="/favicon.svg" />` to `src/app.html`
- Resolves `[404] GET /favicon.ico`

### 2. Threlte + Volumetric Clouds

#### Dependencies

```
three
@threlte/core
@threlte/extras
@takram/three-clouds
```

#### Architecture

```
Window.svelte (existing RAF loop — single clock)
├── CesiumViewer.svelte       (z:0, terrain/imagery/GPU post-process)
├── CloudCanvas.svelte        (z:1, NEW — Threlte transparent overlay)
│   └── <Canvas alpha renderMode="manual">
│       └── VolumetricClouds.svelte (@takram/three-clouds wrapper)
├── CSS: Weather               (z:2, rain/lightning)
├── CSS: Micro-events          (z:3)
├── CSS: Frost                 (z:5)
├── CSS: Wing                  (z:7)
├── CSS: Glass                 (z:9)
├── CSS: Vignette              (z:10)
└── CSS: Glass recess          (z:11)
```

#### Key Design Decisions

1. **Transparent overlay**: Threlte `<Canvas>` renders with `alpha: true` WebGLRenderer so Cesium terrain shows through non-cloud areas
2. **Manual render mode**: `renderMode="manual"` with `autoRender={false}` — the existing RAF in `Window.svelte` calls Threlte's `advance()` to keep a single clock
3. **State sync**: Cloud uniforms driven by AeroWindow reactive state:
   - `effectiveCloudDensity` → cloud opacity/volume
   - `cloudSpeed` → wind animation speed
   - `nightFactor` → cloud color tinting (dark blue at night)
   - `skyState` → sun position for cloud lighting
   - `dawnDuskFactor` → warm edge lighting
4. **Pointer passthrough**: Canvas gets `pointer-events: none` — clicks fall through to Cesium and the blind
5. **Bundle chunking**: Add `three` to Vite `manualChunks` alongside `cesium`
6. **HMR**: Follow the existing `__CESIUM_HMR_CACHE__` pattern for Threlte viewer persistence

#### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/layers/CloudCanvas.svelte` | Create | Threlte Canvas wrapper at z:1 |
| `src/lib/layers/VolumetricClouds.svelte` | Create | @takram/three-clouds Threlte component |
| `src/lib/layers/Window.svelte` | Modify | Replace CSS clouds with CloudCanvas, add Threlte advance() to RAF |
| `vite.config.ts` | Modify | Add three to manualChunks |
| `package.json` | Modify | Add dependencies |

#### Fallback Plan

If `@takram/three-clouds` proves too GPU-heavy for the Raspberry Pi:
- Swap to the simpler FBM raymarching shader (from user's reference code)
- Same Threlte canvas, different shader material
- Fewer ray steps (16 vs 48), no shadow marching

### 3. Architecture Page — Live Layer Previews

Enhance `/architecture` with small (200x150) live preview canvases for each layer:

| Layer Category | Preview Approach |
|---------------|-----------------|
| CSS layers (clouds, frost, rain, wing, vignette, glass) | Self-contained CSS animations in `<div>` elements — no Cesium needed |
| Shader layers (color grading, bloom) | Small Threlte canvas running GLSL on a test gradient |
| Cloud layer | Mini Threlte canvas with VolumetricClouds component |
| Imagery layers (ESRI, VIIRS, CartoDB) | Static annotated thumbnails (can't spin up Cesium per-layer) |

Each preview appears beside its layer bar on expand (click). Architecture page stays standalone — no AeroWindow dependency.

## Build Configuration

```typescript
// vite.config.ts — updated manualChunks
manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('cesium')) return 'cesium';
    if (id.includes('three') || id.includes('@threlte')) return 'three';
  }
  return undefined;
}
```

## Performance Budget

- Target: 30fps minimum on Raspberry Pi 5 (Chromium kiosk)
- Cesium: ~20ms/frame baseline
- Three.js clouds: budget 8ms/frame max
- If over budget: reduce ray steps, render clouds every 2nd frame, or fall back to CSS

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Pi GPU can't handle 2 WebGL contexts | Fallback to simpler FBM shader or CSS clouds |
| @takram/three-clouds API instability (beta) | Pin exact version, wrap in adapter component |
| Bundle size regression | Tree-shake aggressively, separate chunk |
| Threlte + Svelte 5 edge cases | Threlte 8 is Svelte 5 native; pin @threlte/core ^8.3 |
