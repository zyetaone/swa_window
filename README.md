# Aero Dynamic Window

Circadian-aware digital airplane window display built with SvelteKit, Cesium, and CSS effect layers for Raspberry Pi kiosk deployments.

## Quick start

```bash
bun install
cp .env.example .env
bun run dev
```

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite dev server on the LAN |
| `bun run check` | Run `svelte-check` |
| `bun run test` | Run Vitest unit tests |
| `bun run build` | Build the production client/server bundle |
| `bun run preview` | Preview the production build |
| `bun run serve` | Run the custom Bun server from `server.ts` |
| `bun run start` | Build, then run the custom Bun server |

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_CESIUM_ION_TOKEN` | Yes | Cesium terrain and Ion-backed assets |
| `VITE_MAPBOX_TOKEN` | No | Mapbox Satellite imagery override |
| `VITE_TILE_SERVER_URL` | No | Local offline tile server for Pi deployments |
| `VITE_SENTINEL2` | No | Experimental Sentinel-2 imagery mode (requires a tiling proxy) |

## Root layout

- `src/` — app state, simulation engines, routes, and UI
- `static/` — runtime assets such as models, textures, and the service worker
- `docs/` — ADRs, analysis snapshots, reference notes, plans, and codemaps
- `deploy/` — Raspberry Pi provisioning and updater scripts
- `scripts/` — one-off local asset and offline tile helper scripts
- `server.ts` — Bun runtime entrypoint for production/fleet use
- `CLAUDE.md`, `.agent/`, `.jules/`, `.serena/` — repo-local automation and agent metadata

## Key docs

- `CHANGELOG.md` — repo-level release history
- `docs/ADR-001-offline-tile-architecture.md` — offline tile architecture decision record
- `docs/analysis/PROJECT.md` — broad system analysis and deployment context
- `deploy/README.md` — current Pi provisioning status and caveats
- `CLAUDE.md` — architecture and workflow guidance for coding agents
