# Cesium OSM Buildings — Styling Reference

> Captured from Cesium Sandcastle example. Reference for enhancing our building rendering.

## Key API: `Cesium.Cesium3DTileStyle`

The 3D Tiles styling language lets you style individual buildings by their OSM metadata properties.

### Available Properties

```
${feature['building']}              — type: apartments, residential, office, commercial, etc.
${feature['building:material']}     — material: glass, concrete, brick, stone, metal, steel
${feature['cesium#latitude']}       — building center latitude
${feature['cesium#longitude']}      — building center longitude
${feature['cesium#estimatedHeight']} — estimated height in meters
${feature['name']}                  — building name (if tagged in OSM)
```

### Style by Material

```javascript
osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
  defines: {
    material: "${feature['building:material']}",
  },
  color: {
    conditions: [
      ["${material} === null", "color('white')"],
      ["${material} === 'glass'", "color('skyblue', 0.5)"],
      ["${material} === 'concrete'", "color('grey')"],
      ["${material} === 'brick'", "color('indianred')"],
      ["${material} === 'stone'", "color('lightslategrey')"],
      ["${material} === 'metal'", "color('lightgrey')"],
      ["${material} === 'steel'", "color('lightsteelblue')"],
      ["true", "color('white')"],
    ],
  },
});
```

### Filter by Height (useful for cruise altitude view)

```javascript
// Only show buildings taller than 20m — from 30k ft only skyscrapers visible
osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
  show: "${feature['cesium#estimatedHeight']} > 20",
});
```

### Color by Distance from a Point

```javascript
osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
  defines: {
    distance: `distance(vec2(\${feature['cesium#longitude']}, \${feature['cesium#latitude']}), vec2(${lon},${lat}))`,
  },
  color: {
    conditions: [
      ["${distance} > 0.014", "color('blue')"],
      ["${distance} > 0.010", "color('green')"],
      ["${distance} > 0.006", "color('yellow')"],
      ["${distance} > 0.0001", "color('red')"],
      ["true", "color('white')"],
    ],
  },
});
```

### Highlight by Building Type

```javascript
// Residential buildings in cyan
osmBuildingsTileset.style = new Cesium.Cesium3DTileStyle({
  color: {
    conditions: [
      ["${feature['building']} === 'apartments' || ${feature['building']} === 'residential'", "color('cyan', 0.9)"],
      [true, "color('white')"],
    ],
  },
});
```

## Relevance to Aero Window

Our current approach uses Overpass API → GeoJSON → extruded polygons (`CesiumManager.ts:440-490`). This gives per-building color control for night lighting.

The Cesium OSM Buildings 3D Tiles approach (`createOsmBuildingsAsync()`) is an alternative that:
- Covers 350M+ buildings globally (vs Overpass which is per-city on-demand)
- Uses efficient 3D Tiles LOD (auto-simplifies at distance — better for cruise altitude)
- Supports the styling language above for material/type/distance coloring
- But: less control over per-building night lighting (can only use style conditions, not per-frame callbacks)

### Hybrid approach for Aero Window

Use **Cesium OSM Buildings 3D Tiles** at cruise altitude (LOD handles the millions of buildings efficiently) with a **height filter** (only show > 20m). Switch to our **Overpass extruded buildings** on approach (< 15k ft) where we want the detailed night lighting per building.

```javascript
// Cruise: 3D Tiles with height filter
if (altitude > 15000) {
  osmTileset.show = true;
  osmTileset.style = new Cesium.Cesium3DTileStyle({
    show: "${feature['cesium#estimatedHeight']} > 20",
    color: "color('white', 0.8)",
  });
  overpassDataSource.show = false;
} else {
  // Approach: switch to Overpass buildings with night lights
  osmTileset.show = false;
  overpassDataSource.show = true;
}
```

## Source

Cesium Sandcastle: 3D Tiles Styling
https://github.com/CesiumGS/3d-tiles/tree/main/specification/Styling

---

## Gaussian Splats (3D Tiles)

Cesium supports loading Gaussian splat photogrammetry as 3D Tiles. Captured from Sandcastle.

### Loading a splat tileset

```javascript
const splat = await Cesium.Cesium3DTileset.fromIonAssetId(ASSET_ID);
viewer.scene.primitives.add(splat);
viewer.zoomTo(splat, new Cesium.HeadingPitchRange(
  Cesium.Math.toRadians(-50),
  Cesium.Math.toRadians(-20),
  100.0,
));
```

### Split-screen comparison (two tilesets)

```javascript
const left = await Cesium.Cesium3DTileset.fromIonAssetId(3667784);
left.splitDirection = Cesium.SplitDirection.LEFT;
viewer.scene.primitives.add(left);

const right = await Cesium.Cesium3DTileset.fromIonAssetId(3443919);
right.splitDirection = Cesium.SplitDirection.RIGHT;
viewer.scene.primitives.add(right);

viewer.scene.splitPosition = 0.5; // slider at center
```

### Aero Window application

Altitude-based source switching:
- 35k ft: Cesium terrain + satellite + 3D Tiles OSM Buildings
- 15k ft: Switch to Overpass buildings (per-building night lights)
-  5k ft: Switch to Gaussian splat of SWA Hyderabad office area

The splat gives photorealistic ground-level detail on approach —
employees see their actual building from the window.

Requirements:
- Drone scan of the SWA office neighborhood (~20 min flight)
- Process: Luma AI / Polycam / Nerfstudio → Gaussian splat
- Upload to Cesium Ion → auto-converts to 3D Tiles
- ~50-200MB per neighborhood as tiled data
- Free via Cesium Ion free tier

---

## Entity API vs Primitive API — Performance Decision

**Entity API** (high-level): Easy, few lines of code, but CPU-managed.
Each entity's properties (color, visibility) are evaluated per-frame on CPU.
Our Overpass buildings use this — `GeoJsonDataSource` with `CallbackProperty`
for per-building night lighting. This is why Pi GPU process hits 35% CPU.

**Primitive API** (low-level): Direct GPU access, instanced rendering.
`Cesium3DTileset` (OSM Buildings) uses this internally — LOD-managed,
GPU-instanced, minimal CPU overhead.

### Decision for Aero Window

```
Cruise (>15k ft): Primitive API via 3D Tiles — GPU handles 350M buildings
Approach (<15k ft): Entity API via Overpass — CPU manages ~5K buildings
                    with per-frame night lighting (acceptable at low count)
```

### Key patterns for future GPU work

- `CZM_batchTable` prefix: bridge between batch table and GLSL shaders
- Instance attributes: per-object color/visibility without CPU overhead
- Vertex attributes: geometry scaling (e.g., sensor visibility at zoom)
- Custom GLSL via `Appearance`: full shader control

Our `cesium-shaders.ts` color grading already uses custom GLSL post-process.
If we ever need per-cloud GPU control, the Primitive API + custom Appearance
is the path.
