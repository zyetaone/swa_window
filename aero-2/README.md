# Aero 2

Minimal rewrite of [Aero Dynamic Window](../) — one slice at a time.

**Stack:** SvelteKit · Svelte 5 runes · MapLibre GL · adapter-node (Pi kiosk).

```sh
bun install
bun run dev      # http://0.0.0.0:5173
bun run check && bun run test
```

Layout and invariants: `docs/ARCHITECTURE.md`. Cesium was the ship path
until 2026-08-25; its code was removed, not archived — see
`docs/ADR-005-aero-2-threlte-renderer.md` for why and what a reversal costs.

## Offline tiles

1. Populate `data/tiles/` with `gibs/`, `usgs/` and `terrarium/` layers (WMTS
   layout: `{layer}/{z}/{y}/{x}.ext`), or symlink to parent repo `../data/tiles`.
2. Optional `TILE_DIR=data/tiles` in `.env`.
3. `bun run build && node build/index.js`

`/api/tiles/health` reports which layers are present. Nothing hard-fails on
an empty cache: missing colour is a blank tile, missing elevation is a flat
ellipsoid.

### Dev with a sparse cache

`bun run dev` enables **remote tile fallback** when `NODE_ENV=development`
(Vite sets this): missing local tiles are proxied from GIBS / USGS /
terrarium — see `remoteTileUrl()` in `src/lib/server/tiles.ts`, the one place
any of those hosts is named. On the Pi — unset `NODE_ENV`, no fallback unless
`AERO_TILE_REMOTE_FALLBACK=1`.
