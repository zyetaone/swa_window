# Aero 2 architecture

Minimal rewrite of v1 (`../`). One slice per PR, wall-verified before the next.

## Files

```
src/lib/
  model.svelte.ts      state — AeroWindow, FlightEngine, config, DTOs
  rules.ts             pure — orbit, atmosphere, imagery, lighting
  globe.svelte.ts      Cesium — attachment, runtime, sync, tile cache
  game-loop.ts         RAF singleton
  utils.ts
  assets/data.ts       authored bands, imagery sources, LOD numbers
  server/tiles.ts      tile API (dir, path guard, CORS)
routes/                +page.svelte, /api/tiles
```

**Forbidden:** `globe.svelte.ts` → `model.svelte.ts`.  
**Forbidden:** `rules.ts` → Svelte runes or Cesium.

## Data flow

```
game-loop RAF (after worldRuntime.opened)
  → model.tick(dt)
  → model.frame()        GlobeSyncSlice
  → worldRuntime.sync()  fan-out inside globe.svelte.ts
```

## Invariants

1. Single Viewer — `globe()` attachment only.
2. Cesium isolation — runtime `import('cesium')` only in `globe.svelte.ts`.
3. Svelte runes in `.svelte.ts` for shared reactive state.
4. Offline imagery — `/api/tiles` first; dev proxies sparse misses to EOX/Esri; Ion fallback when cache empty.
5. Fleet determinism — wall-clock orbit; no `Math.random()` in hot path.
