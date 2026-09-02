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
| `viirs/`          | WMTS `{z}/{y}/{x}.png` | no city lights after dark        |

`terrarium/` is build INPUT for `tools/pack-pmtiles.ts`, not something the
kiosk requests. A pack holding only terrarium draws nothing.

```sh
bun tools/download-tiles.ts gibs  <lat> <lon> 1500 7 8   # per location
bun tools/download-tiles.ts viirs <lat> <lon> 1500 7 8
bun tools/pack-pmtiles.ts terrarium data/tiles/terrain.pmtiles
bun run build && node build/index.js
```

**1500 km, not 50.** At cruise altitude on a globe projection the camera sees
most of a continent, so a city-sized radius leaves holes that appear only at
certain points in the orbit. Global z0–6 plus these corridors is ~240 MB and
covers every location with zero 404s, measured by driving all eleven.

`GET /api/tiles/health` answers `ok` / `degraded` / `error` and names what is
absent in `missing[]`. It asserts the assets above rather than counting
directories — it reported `{"status":"ok","hasTiles":true}` over a pack with no
imagery at all until 2026-09-03, which is the only reason the blank ground took
so long to spot. **`error` means the window will not draw the world.**

### Dev with a sparse cache

`bun run dev` enables **remote tile fallback** when `NODE_ENV=development`
(Vite sets this): missing local tiles are proxied from GIBS / terrarium — see
`remoteTileUrl()` in `src/lib/server/tiles.ts`, the one place any of those hosts
is named. On the Pi — unset `NODE_ENV`, no fallback unless
`AERO_TILE_REMOTE_FALLBACK=1`.

Because of that fallback, a dev box renders correctly over an empty archive.
Check `/api/tiles/health`, or run `NODE_ENV=production node build/index.js`, to
see what the Pi will actually see.
