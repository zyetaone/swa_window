# Aero 2

Minimal rewrite of [Aero Dynamic Window](../) — one slice at a time.

**Stack:** SvelteKit · Svelte 5 runes · MapLibre GL · adapter-node (Pi kiosk).

```sh
bun install
bun run dev      # http://0.0.0.0:5173
bun run check && bun run test
bun run build && bun run smoke   # loads every route in headless Chrome
```

Layout and invariants: `docs/ARCHITECTURE.md`. One renderer: MapLibre GL.
Cesium was a selectable second engine and was deleted on 2026-08-31 — removed,
not archived. See `../docs/ADR-005-aero-2-threlte-renderer.md` (parent repo) for the renderer
direction and what a reversal costs.

## Offline tiles

The archive lives in `data/tiles/` — **not** `static/`, which would hand ~56k
files to Vite's static copy and serve them outside the `/api/tiles` guard.

What a complete pack holds, and what each absence costs:

| Asset             | Kind                   | Missing means                    |
| ----------------- | ---------------------- | -------------------------------- |
| `gibs/`           | WMTS `{z}/{y}/{x}.jpg` | no ground colour — a white sheet |
| `terrain.pmtiles` | PMTiles v3             | flat ellipsoid, no relief        |
| `sentinel2/`      | WMTS `{z}/{y}/{x}.jpg` | ground drops to 306 m/px MODIS   |
| `viirs/`          | WMTS `{z}/{y}/{x}.png` | no city lights after dark        |

`terrarium/` is build INPUT for `tools/pack-pmtiles.ts`, not something the
kiosk requests. A pack holding only terrarium draws nothing.

What a fielded Pi actually carries, measured:

| Asset             |   Size |
| ----------------- | -----: |
| `terrain.pmtiles` | 3.5 GB |
| `sentinel2/`      | 312 MB |
| `gibs/`           | 123 MB |
| `viirs/`          | 102 MB |
| **served total**  | 4.0 GB |

`terrarium/` (3.6 GB) is not in that total — it stays on the machine that
repacks the DEM. If the SD budget ever binds, the DEM is what to attack; the
imagery is a tenth of it.

```sh
bun tools/download-tiles.ts gibs  <lat> <lon> 1500 7 8   # per location
bun tools/download-tiles.ts viirs <lat> <lon> 1500 7 8
bun tools/pack-pmtiles.ts terrarium data/tiles/terrain.pmtiles
python3 tools/fetch-sentinel2.py <place> --min-zoom 8 --max-zoom 13
bun run build && node build/index.js
```

**1500 km, not 50.** At cruise altitude on a globe projection the camera sees
most of a continent, so a city-sized radius leaves holes that appear only at
certain points in the orbit. Global z0–6 plus these corridors is ~240 MB and
covers every location with zero 404s, measured by driving all eleven.

### The sharp basemap

`sentinel2/` is what makes the window look like a window: packed to z13
(19 m/px) against MODIS's z9 (306 m/px), and effectively cloudless. The sensor
is 10 m, so z14 is the last zoom backed by real pixels — z13 is where the
storage budget landed, not a limit of the data. It is laid **over** MODIS rather than
replacing it — the pack is a box around each location, and Sentinel-2 produces
no scenes over open ocean at all, so a missing tile reveals the layer
underneath instead of punching a hole.

Built by `tools/fetch-sentinel2.py` from the public `sentinel-cogs` bucket.
Needs **GDAL** (`brew install gdal`) and Pillow. Budget 10-20 minutes and ~7 GB
of scratch per location; the scratch (`data/tiles/_s2-<place>/`) is safe to
delete once tiled, and each finished pack is ~50 MB.

Two boxes, both sized by measurement: wide-and-coarse (1.2 deg, z8-11) for the
far field, tight-and-sharp (0.65 deg, z12-13) near the aircraft, which is where
the browser asks for the high zooms. Going wider is not a budget question —
3.0 deg pulled 60 scenes and ~20 GB of scratch per location, AND pushed
worst-case cloud from 0.07% to 4.91%, because one clear day across a wider box
is strictly harder to find.

The tool refuses rather than shipping something wrong. Both refusals mean what
they say:

- _"mosaic is N% empty — refusing to tile"_: the chosen scenes leave black
  wedges. Widen `--start`/`--end`.
- _"No 15-day window covers every tile"_: no single clear acquisition spans the
  visible box. Widen the dates, or raise `--max-cloud`.

It insists on ONE acquisition date across every scene because a per-tile "best"
date mosaics different seasons together and shows as colour steps at the seams.

**Licence: Copernicus** — free, full and open, commercial use permitted,
**attribution required**. The required wording is in `TILE_ATTRIBUTION`. Do not
swap in EOX s2cloudless, which serves this same imagery far more conveniently
and is CC BY-NC-SA, i.e. non-commercial.

`GET /api/tiles/health` answers `ok` / `degraded` / `error` and names what is
absent in `missing[]`. It asserts the assets above rather than counting
directories — it reported `{"status":"ok","hasTiles":true}` over a pack with no
imagery at all until 2026-09-03, which is the only reason the blank ground took
so long to spot. **`error` means the window will not draw the world.**

It also reports `unused[]`: directories the kiosk never requests, largest
first. On an SD-card budget that is worth watching — the pack here carries
2.8 GB of raw Sentinel GeoTIFFs (`_s2-hyderabad`) left by an abandoned warp,
which the health readout used to present as a `layer`. Nothing is ever deleted
automatically. `terrarium/` is not flagged: it is build input for
`pack-pmtiles`, so it is dead weight on a Pi but wanted on the machine that
repacks the DEM.

### Imagery is ~30% cloud, and that is not a bug you can fix here

`GIBS_DATE` pins one MODIS day. MODIS true colour is a same-day swath, so
across the z6–z9 tiles the window requests, the best eligible day still
measures ~30% near-white and most measure 38–54%. Swapping dates moves it a few
points. If the ground looks washed out, that is the photograph.

`python3 tools/survey-gibs-date.py <dates...>` scores candidates on coverage
(a gate) and clarity (the tiebreak), sampling every zoom the renderer draws.
Run a date twice before rejecting it — the network can fail a tile, and a
rejection on one run that clears on the next was transport, not the archive.

The structural fix is a cloudless composite: EOX s2cloudless measures 4.6% on
the same metric, but it is CC BY-NC-SA and unusable on a paid install. See the
note above `GIBS_DATE`.

### Dev with a sparse cache

`bun run dev` enables **remote tile fallback** when `NODE_ENV=development`
(Vite sets this): missing local tiles are proxied from GIBS / terrarium — see
`remoteTileUrl()` in `src/lib/server/tiles.ts`, the one place any of those hosts
is named. On the Pi — unset `NODE_ENV`, no fallback unless
`AERO_TILE_REMOTE_FALLBACK=1`.

Because of that fallback, a dev box renders correctly over an empty archive.
Check `/api/tiles/health`, or run `NODE_ENV=production node build/index.js`, to
see what the Pi will actually see.
