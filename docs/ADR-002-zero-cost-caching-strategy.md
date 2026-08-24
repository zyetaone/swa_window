# ADR-002 — Zero-Cost Caching Strategy

**Status:** Accepted
**Date:** 2026-04-15
**Supersedes:** extends ADR-001 (offline tile architecture)

## Context

The product (Aero Dynamic Window) ships on Raspberry Pi kiosks to end customers
— potentially at fleet scale. Ongoing per-device API costs (Cesium Ion,
Mapbox, etc.) would compound with fleet size and make the unit economics
unviable. The product needs to render indefinitely without external API
dependency once installed — network access is only used for:

1. Fleet server sync (LAN)
2. WiFi portal setup (install time)
3. Initial manufacture-time tile download (build machine only)

All map, terrain, building, and night-light data must ship pre-baked on the
device's SD card.

## Decision

**Cache-primary, remote-fallback for every external tile source.**

Every API call the app makes at runtime is checked against a local cache
first. Remote origin is only consulted on cache miss or at dev time without
a populated cache.

### Source matrix

| Source | Runtime path | Build-time origin | Cached locally | Fallback on cache miss |
|---|---|---|---|---|
| Base imagery | `/api/tiles/eox-sentinel2/{z}/{y}/{x}.jpg` | `tiles.maps.eox.at/.../s2cloudless-2024_3857/…` | ✅ yes | EOX origin (free, rate-limited) |
| VIIRS night lights (imagery) | GIBS WMTS or `/api/tiles/viirs-night-lights/…` | NASA GIBS | ✅ yes | GIBS remote |
| **Night street lamps (vector)** | `/api/roads/{city}.geojson` + runtime `viirs-field` | OSM Overpass → `data/roads/` | ✅ yes (git deploy) | none — ODbL polylines |
| Night overlay (CartoDB) | `/api/tiles/cartodb-dark/…` | `basemaps.cartocdn.com/dark_nolabels/…` | optional legacy | CartoDB origin |
| **Night roads (baked raster)** | `/api/tiles/viirs-roads/…` — **not loaded at runtime** | `viirs-roads.ts` bake | optional legacy | n/a |
| **Terrain (primary)** | `/api/tiles/cesium-terrain/{z}/{x}/{y}.terrain` | Cesium Ion (asset 1, World Terrain) | ✅ **NEW** — quantized-mesh, build-time Ion token | Terrarium (below) |
| **Terrain (fallback)** | `/api/tiles/terrarium/{z}/{x}/{y}.png` | `s3.us-west-2.amazonaws.com/elevation-tiles-prod/terrarium/…` | ✅ **NEW** — PNG heightmap | AWS S3 origin |
| **3D Buildings** | `/api/buildings/{city}.geojson` | Overpass API (`[building=*]` query) | ✅ **NEW** — extrusion GeoJSON per city | Overpass origin (free, rate-limited) |
| Skybox stars | `/cesiumStatic/Assets/Textures/SkyBox/…` | Cesium npm package | ✅ yes (vite-plugin-static-copy) | n/a — always local |

### Storage budget (per Pi)

- Imagery (EOX z3–12, 18 cities): ~350 MB
- Vector roads (GeoJSON, 8 cities): ~4 MB (ships via `git pull`, not tile rsync)
- VIIRS night-lights imagery (z8): ~80 MB
- Night overlay + baked viirs-roads (optional legacy caches): ~280 MB
- Terrain primary (Ion mesh): ~200 MB
- Terrain fallback (Terrarium PNG): ~300 MB
- Buildings (GeoJSON, 8 cities): ~20 MB

**Total: ~1.2 GB** with full legacy tile caches; **~900 MB** without CartoDB/viirs-roads raster layers.

### Night street lamps — vector + VIIRS (runtime)

The kiosk draws the street grid as **ODbL vector polylines** (`world/roads-geojson`),
not a CartoDB raster. Each segment samples `viirs-field` at load time and
applies the shared glow curve (`viirs-glow.ts`: `floor + (1 − floor) · luminance`,
default floor 0.15) so lamps bloom inside real lit cores and stay dim in dark
outskirts — the same intent as the old baked composite, without a 132 MB tile
layer or Cesium `colorToAlpha` keying bugs.

VIIRS imagery (`viirs-night-lights` / GIBS) remains the coarse city halo;
vector roads + building windows carry structure. Three.js neon/wing effects
read the same `viirs-field` SSOT.

### Implementation

1. **`tools/tile-packager/src/sources.ts`** extends with new sources:
   - `cesium-terrain` (Ion build-time, requires `VITE_CESIUM_ION_TOKEN`)
   - `terrarium` (public S3, no auth)
   - `osm-buildings` (Overpass, per-city GeoJSON not tile-format)
2. **`src/routes/api/tiles/[...path]/+server.ts`** already handles arbitrary path passthrough. No changes needed for tile sources. Buildings get a new `/api/buildings/[city]` route.
3. **Device `CesiumTerrainProvider`** tries in order:
   - `${TILE_SERVER_URL}/cesium-terrain` (cached Ion mesh)
   - `${TILE_SERVER_URL}/terrarium` via custom heightmap provider (cached fallback)
   - Remote Ion (if token present + network available)
   - Remote Terrarium (always free, last resort)
   - `EllipsoidTerrainProvider` (flat earth, degraded visual)
4. **Cesium Ion token** is a BUILD-TIME secret. Production device ships without it. Optional runtime presence enables the "remote-fallback for cache miss" path for admins doing field installs.

### Why Option 3 over Option 1 or 2

- **Option 1 (Ion only)** — highest quality, but if the Ion free-tier agreement changes or the asset is rotated, every shipped device loses terrain until remanufactured.
- **Option 2 (Terrarium only)** — pure FOSS, but AWS could drop the public S3 bucket; degraded visual vs Ion mesh.
- **Option 3 (both cached)** — survives either provider disappearing. 500 MB disk overhead is acceptable for vendor-risk elimination in a product we don't maintenance-contract.

### Baked VIIRS × roads composite (`viirs-roads`) — legacy cache only

**The app does not load this layer.** It remains in the tile packager for
manufacturing older caches. See `tools/tile-packager/src/viirs-roads.ts`.

The raw cartodb-dark road mask glows uniformly — streets light up even where
VIIRS says there is no city. The offline bake multiplied each road tile's RGB
by VIIRS luminance and wrote a graded alpha mask (`ALPHA_LO`/`ALPHA_HI` in
`viirs-roads-math.ts`). Runtime vector roads supersede this; the bake is kept
for field devices that still carry the raster on disk.

Output: `viirs-roads/{z}/{x}/{y}@2x.png` (z4–12, RGBA PNG). Run after the
normal packager: `cd tools/tile-packager && bun run viirs-roads`.

### Why cache-primary (not cache-fallback)

Cache-fallback means every boot tries remote first → spends GB of data → falls back to local only on failure. A fleet of 50 devices on office WiFi on the same morning hammers the origins and hits rate limits. Cache-primary means local-first always, remote only on demonstrable miss. Zero ongoing cost in steady state.

## Consequences

**Positive**
- Product has zero steady-state per-device cost across fleet.
- Works offline indefinitely after install.
- Survives individual provider deprecation via layered fallback.
- Fleet-scale rollout doesn't require negotiating enterprise API tiers.

**Negative**
- Manufacture pipeline becomes longer (one-time ~15 min tile download per SD card image).
- Adding a new location requires rebuilding SD card images, not just pushing a config.
- Terrarium fallback has lower mesh quality than Ion — noticeable on Himalayas, subtle elsewhere.
- Overpass-derived buildings are flat-roof extrusions only; no roof detail vs Ion OSM Buildings 3D tileset.

## Open questions

- Do we deliver OTA tile updates to fielded devices, or is it SD-card-reimage only? (Recommend: fleet-server-pushed tile deltas via the existing bundle system.)
- Is it acceptable for Himalayas / Alps to use Terrarium fallback if Ion changes, or does terrain quality need to be uniform? (Depends on customer tier.)
