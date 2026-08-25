# Aero 2

Minimal rewrite of [Aero Dynamic Window](../) — one slice at a time.

**Stack:** SvelteKit · Svelte 5 runes · Cesium · adapter-node (Pi kiosk).

```sh
bun install
bun run dev      # http://0.0.0.0:5173
bun run check && bun run test
```

Layout and invariants: `docs/ARCHITECTURE.md`.

## Offline imagery

1. Populate `data/tiles/` (or symlink to parent repo `../data/tiles`).
2. Optional `TILE_DIR=data/tiles` in `.env`.
3. `bun run build && node build/index.js`

The globe probes `GET /api/tiles/health` at boot. Day imagery prefers `eox-sentinel2`, then `esri-world-imagery`. Night swap to `cartodb-dark` only when that pack exists locally.

### Dev with a sparse cache

`bun run dev` enables **remote tile fallback** when `NODE_ENV=development` (Vite sets this): missing local tiles are proxied from EOX / Esri / Carto. On the Pi — unset `NODE_ENV`, no fallback unless `AERO_TILE_REMOTE_FALLBACK=1`.

## Dev without local tiles

Empty `data/tiles/` → ellipsoid terrain. Optional `VITE_CESIUM_ION_TOKEN` enables Ion imagery fallback when the health probe reports no layers.
