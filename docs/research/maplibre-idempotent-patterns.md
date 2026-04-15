# MapLibre GL JS — Idempotent & Reactive Patterns

> Reference for the playground scene lab and future Cesium → MapLibre migration work.
> Focused on Svelte 5 runes, Pi 5 performance constraints, and the imperative/declarative bridge.

---

## 1. Recommended Patterns

### 1.1 Source → Layer Nesting (The Core Idiom)

The library's central pattern: sources own their layers as children. When the source component mounts it calls `addSource`; when it unmounts it calls `removeSource` (and cascades to remove child layers first). **You never call these APIs directly.**

```svelte
<GeoJSONSource id="flights" data={geojsonData}>
  <CircleLayer
    paint={{ 'circle-radius': 6, 'circle-color': '#ff6b35' }}
    filter={['==', ['get', 'active'], true]}
  />
  <SymbolLayer layout={{ 'text-field': ['get', 'label'] }} />
</GeoJSONSource>
```

When `geojsonData` (a `$derived`) changes, the `GeoJSONSource` component calls `source.setData(newData)` automatically — no `map.getSource().setData()` ever appears in your code.

### 1.2 Reactive Paint via Props (Not setPaintProperty)

Pass paint/layout as plain objects derived from `$state`/`$derived`. The wrapper diffs props and calls `setPaintProperty`/`setLayoutProperty` per-key. The expression is baked at style-load so the value only re-uploads when the Svelte prop reference changes — not every frame.

```svelte
<script lang="ts">
  let { nightFactor } = $props();
  const buildingColor = $derived([
    'interpolate', ['linear'], ['get', 'render_height'],
    0,   `rgba(${Math.round(180 * (1 - nightFactor))}, 170, 160, 0.85)`,
    400, `rgba(${Math.round(225 * (1 - nightFactor))}, 220, 210, 1.0)`,
  ]);
</script>

<FillExtrusionLayer paint={{ 'fill-extrusion-color': buildingColor }} />
```

**Pi caveat**: `$derived` re-evaluates when `nightFactor` changes. Keep the expression shallow — don't construct complex nested arrays inside a 60 Hz RAF loop.

### 1.3 Feature-State for Per-Feature Animation

`FeatureState` is a declarative wrapper around `map.setFeatureState`. Use it for hover/selection — **not** for high-frequency animation (see antipatterns).

```svelte
<GeoJSONSource id="states" data={statesGeoJson}>
  <FillLayer
    paint={{
      'fill-opacity': ['case',
        ['boolean', ['feature-state', 'hover'], false], 0.6, 0.15]
    }}
    onmousemove={(ev) => { hoveredId = ev.features?.[0]?.id }}
    onmouseleave={() => { hoveredId = undefined }}
  />
  {#if hoveredId != null}
    <FeatureState id={hoveredId} state={{ hover: true }} />
  {/if}
</GeoJSONSource>
```

### 1.4 Global State for Uniform Scene Parameters

`globalState` on the `<MapLibre>` root is a dict that layer filters/expressions can read with `['global-state', 'key']`. Perfect for scene-wide parameters like `skyState` or `weatherType` without per-layer prop updates.

```svelte
<MapLibre globalState={{ skyState, weatherType }}>
  <FillLayer
    filter={['case',
      ['==', ['global-state', 'skyState'], 'night'],
      ['get', 'show_at_night'],
      true
    ]}
  />
</MapLibre>
```

### 1.5 RAF Loop Tied to $effect with Cleanup Return

Any animation driving MapLibre (frame counter, canvas source, animated GeoJSON) goes inside `$effect`. The cleanup return cancels the RAF — critical for component remounts in the playground.

```svelte
<script lang="ts">
  let frame = $state(0);

  $effect(() => {
    let raf: number;
    function tick() {
      frame = (frame + 1) % FRAME_COUNT;
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<ImageSource url={`/frames/radar-${frame}.png`} coordinates={bbox}>
  <RasterLayer paint={{ 'raster-fade-duration': 0 }} />
</ImageSource>
```

### 1.6 Canvas Source for WebGL-Bypass Compositing

When you want to draw on an offscreen canvas (CSS rain, SVG turbulence renders) and composite it into the map's tile stack at a fixed geographic bbox, `CanvasSource` avoids a custom WebGL layer entirely.

```svelte
<canvas bind:this={canvas} width={512} height={512} style="display:none" />
<CanvasSource {canvas} animate={true} coordinates={bbox}>
  <RasterLayer paint={{ 'raster-opacity': 0.7, 'raster-fade-duration': 0 }} />
</CanvasSource>
```

The `animate: true` flag tells MapLibre to call `canvas.getContext('2d')` and re-upload the texture each frame via `ImageBitmap` path — no explicit repaint call needed.

### 1.7 Map Access via bind:map for Escape-Hatch Imperatives

When you need the raw `maplibregl.Map` instance (flyTo, queryRenderedFeatures, etc.), use `bind:map`. This is the sanctioned escape hatch.

```svelte
let mapRef = $state<maplibregl.Map | undefined>();

<MapLibre bind:map={mapRef} ...>
  ...
</MapLibre>

// in a function (not a $effect):
mapRef?.flyTo({ center: [lon, lat], zoom: 10, duration: 1500 });
```

Already in use in `MapLibreGlobe.svelte` — the pattern is correct as-is.

---

## 2. Antipatterns to Avoid

**Calling addSource/addLayer imperatively inside $effect.** The wrapper owns the lifecycle. If you call `map.addSource('x', ...)` manually and the component also tries to, you get duplicate-source errors or dangling layers on cleanup.

```typescript
// WRONG
$effect(() => {
  const map = mapRef;
  if (!map) return;
  map.addSource('weather', { type: 'geojson', data: geoJson }); // leaks on remount
  map.addLayer({ id: 'weather-fill', source: 'weather', ... });
  // no cleanup — layer/source never removed
});
```

**Constructing paint expressions inside a 60 Hz RAF loop.** Building nested arrays allocates GC pressure. Derive them at state-change time, not per-frame.

```typescript
// WRONG — runs every tick()
const paint = $derived.by(() => {
  return { 'fill-color': buildExpression(model.nightFactor) }; // allocation per tick if nightFactor is in untrack zone
});
```

**setFeatureState on many features at 60 Hz.** There is a confirmed MapLibre issue (#6633) where large feature-state maps cause zoom stalls as every feature is re-evaluated against every expression. Keep feature-state to hover/selection (~1 feature at a time). For per-feature animation at scale, encode state into the GeoJSON data itself and call `setData()`.

**preserveDrawingBuffer: true.** Costs ~2x VRAM on Pi 5's VideoCore VII. Never enable unless you need `canvas.toBlob()` (you don't).

**Large GeoJSON as inline JS objects.** Embed as a URL string or a `$state.raw()` ref. Wrapping a 50k-feature FeatureCollection in deep `$state` proxy causes thousands of proxy trap calls on every `setData`.

```typescript
// CORRECT
let geoJsonUrl = $state<string>('');          // string URL, or
let geoJsonData = $state.raw<FeatureCollection>(null);  // raw ref for large objects
```

**Creating the Map inside a Svelte component not at the route level.** Map construction is expensive (~200 ms). Avoid conditional rendering (`{#if showMap}`) that destroys and recreates the MapLibre instance. Instead use CSS visibility toggling and `fadeDuration: 0`.

---

## 3. Custom WebGL Layer Integration

MapLibre's `{ type: 'custom', render }` interface is the clean seam for Three.js or raw WebGL. The `<CustomLayer>` component wraps this.

### Three.js Pattern (from svelte-maplibre-gl threejs-model example)

```typescript
class ThreeLayerImpl implements maplibregl.CustomLayerInterface {
  id = 'three-overlay';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private scene = new THREE.Scene();
  private renderer!: THREE.WebGLRenderer;

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: false,          // Pi: disable for performance
    });
    this.renderer.autoClear = false;
    // load GLTF model into this.scene ...
  }

  render(_gl: WebGLRenderingContext, args: maplibregl.CustomRenderMethodInput) {
    const modelMatrix = map.transform.getMatrixForModel(origin, scale);
    const camera = new THREE.Camera();
    camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix);
    camera.projectionMatrix.multiply(new THREE.Matrix4().fromArray(modelMatrix));

    this.renderer.resetState();
    this.renderer.render(this.scene, camera);
    map.triggerRepaint();
  }
}
```

```svelte
<CustomLayer implementation={new ThreeLayerImpl()} />
```

**Key rules:**
- Always call `renderer.resetState()` before `renderer.render()` — MapLibre mutates WebGL state between frames.
- Call `map.triggerRepaint()` only when you have animation; skip it for static models.
- Set `antialias: false` and skip `powerPreference` — Pi's VideoCore doesn't benefit from hints.
- The vertex shader must inject `"${shaderDescription.vertexShaderPrelude}"` for globe-aware projection. Without it, geometry clips at the horizon in globe mode.

### Raw WebGL Pattern (no Three.js)

```typescript
onAdd(map, gl) {
  this.program = createProgram(gl, VERT_SRC, FRAG_SRC);
  this.buf = gl.createBuffer();
}

render(_gl, { defaultProjectionData }) {
  const { mainMatrix } = defaultProjectionData;
  gl.useProgram(this.program);
  gl.uniformMatrix4fv(uMatrix, false, mainMatrix);
  gl.drawArrays(gl.POINTS, 0, this.count);
  // no triggerRepaint — only needed for animation
}
```

This is the approach used for the car-lights Cesium point entities equivalent — low overhead, no framework dependency.

---

## 4. GeoJSON as the Artistic Palette

### Data-Driven Night Rendering

Rather than computing RGBA strings in Svelte (`MapLibreGlobe.svelte` lines 122–130), encode scene parameters into the style expression and drive them with `setPaintProperty` or `globalState`:

```javascript
// In a GeoJSON scene file: each feature has `height` property
// In the style expression — bake the night curve into the interpolation
'fill-extrusion-color': [
  'interpolate', ['linear'], ['zoom'],
  13, ['interpolate', ['linear'], ['get', 'height'],
    0,   ['to-color', ['concat', 'rgb(',
            ['to-string', ['*', 140, ['global-state', 'dayBrightness']]], ',',
            ['to-string', ['*', 135, ['global-state', 'dayBrightness']]], ',',
            ['to-string', ['*', 125, ['global-state', 'dayBrightness']]], ')'
          ]],
    400, '#ddd'
  ]
]
```

**Simpler alternative (what MapLibreGlobe already does):** recompute the paint object in a `$derived` and let the wrapper call `setPaintProperty`. This is fine as long as `nightFactor` doesn't change more than a few times per second. Avoid constructing it inside `model.tick()`.

### Curated Scene Files as GeoJSON

Proposed pattern for the playground:

```
src/routes/playground/scenes/
├── dubai-day.geojson       city footprints, landmarks, altitudes
├── dubai-night.geojson     same features, dark palette + emissive properties
└── himalayas-peaks.geojson peak labels, elevation, treeline polygons
```

Each feature carries `{ "type": "Feature", "properties": { "label": "Burj Khalifa", "height": 828, "category": "landmark" } }`. The layer expressions render everything; the data file is the content. This separates authoring (edit GeoJSON in QGIS or geojson.io) from rendering (Svelte/MapLibre expressions).

### Efficient setData vs Layer Re-add

- `setData()` re-tiles the source in a worker thread. Visible ~200 ms latency for large sets.
- For streaming updates (e.g., live aircraft positions): use `GeoJSONSourceDiff` — append/remove individual features by id without full re-tile.
- For static scene swaps (location change): a full `setData()` is correct. The old tiles are replaced smoothly if `fadeDuration` is non-zero; set to 0 on Pi for snappier transitions.

---

## 5. Plugin Picks

| Plugin | Status | Use case |
|---|---|---|
| `@svelte-maplibre-gl/pmtiles` | Production | Offline tile bundles — already in use |
| `maplibre-contour` | Production | Terrain contour lines; pairs with raster-dem |
| `deck.gl` (overlay mode) | Production | Advanced point/line/polygon layers; `DeckGLOverlay` component exists in svelte-maplibre-gl |
| `maplibre-three-plugin` | Beta | Three.js bridge with globe-aware projection matrices |
| `map-gl-offline` | Experimental | IndexedDB tile caching; worth watching but untested on Pi |
| `@mapbox/mapbox-gl-draw` | Production (Mapbox API) | Drawing tools; functional but not globe-aware |
| `terra-draw` | Production | Drawing/editing; has MapLibre adapter; globe-aware |

**Skip:** `maplibre-gl-geocoder` (requires network), `mapbox-gl-elevation` (Mapbox API surface).

---

## 6. References

- [svelte-maplibre-gl (MIERUNE) — GitHub](https://github.com/MIERUNE/svelte-maplibre-gl)
- [svelte-maplibre-gl — Examples site](https://svelte-maplibre-gl.mierune.dev/examples/)
- [Hover styles + FeatureState example](https://svelte-maplibre-gl.mierune.dev/examples/hover-styles)
- [Three.js model custom layer example](https://svelte-maplibre-gl.mierune.dev/examples/threejs-model)
- [globe-atmosphere example](https://svelte-maplibre-gl.mierune.dev/examples/globe-atmosphere)
- [MapLibre Plugins directory](https://maplibre.org/maplibre-gl-js/docs/plugins/)
- [MapLibre Style Spec — Expressions](https://maplibre.org/maplibre-style-spec/expressions/)
- [MapLibre large GeoJSON optimization guide](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)
- [MapLibre Map API — MapOptions](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/)
- [Building color by zoom — setPaintProperty canonical example](https://maplibre.org/maplibre-gl-js/docs/examples/change-building-color-based-on-zoom-level/)
- [setFeatureState zoom-lag issue #6633](https://github.com/maplibre/maplibre-gl-js/issues/6633)
- [setData performance issue #106](https://github.com/maplibre/maplibre-gl-js/issues/106)
- [Memory leak on map.remove() — tracked issue #4811](https://github.com/maplibre/maplibre-gl-js/issues/4811)
- [react-map-gl intro — imperative/declarative bridge rationale](https://visgl.github.io/react-map-gl/docs)
