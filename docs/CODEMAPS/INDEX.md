# Aero Window Codemap

**Last Updated:** 2026-04-26

## Quick Navigation

| Document | Scope |
|----------|-------|
| [File Inventory](files.md) | Source layout — folder by folder, top files by size |
| [Architecture](architecture.md) | Layer diagram, data flow, key interfaces |
| [Scene composition](scene.md) | Effect contract, registry, z-layer SSOT |
| [Content API](content-api.md) | Bundle CRUD + LAN cache + remote push |
| [Security boundaries](security.md) | Trust zones, validation, CSP, sensitive data |

> The authoritative architecture lives in `CLAUDE.md` at the repo root.
> CODEMAPS summarise per-concern slices.

## Codebase stats (live as of phase 11)

| Tree | Files | Lines |
|------|------:|------:|
| `src/lib/` | 78 | 9,183 |
| `src/routes/` | 22 | 2,782 |
| `content/` | 8 | 316 |

## Architecture at a glance

```
                         DEPENDENCY LAYERS

 ┌─────────────────────────────────────────────────────┐
 │  ROUTES                                             │
 │  +layout.ts (ssr=false) → +page.svelte → admin/    │
 │  /playground (lean composition lab)                │
 └──────────────┬─────────────────┬───────────────────┘
                │                 │
                v                 v
 ┌─────────────────────┐  ┌──────────────────────────┐
 │  MODEL              │  │  SHELL                   │
 │  AeroWindow + ctx   │  │  Window (compositor)     │
 │  config tree (SSOT) │  │  HUD, SidePanel,         │
 │  CRDT LWW store     │  │  panel/* hud/* window/*  │
 └───┬───────┬─────────┘  └──────────┬───────────────┘
     │       │                       │
     v       v                       v
 ┌────────┐ ┌──────────┐  ┌─────────────────────────┐
 │CAMERA  │ │DIRECTOR  │  │ SCENE                    │
 │flight  │ │autopilot │  │ compositor + registry +  │
 │motion  │ │scenarios │  │ layers + effects/* +     │
 │        │ │          │  │ bundle/*                 │
 └────────┘ └──────────┘  └────────────┬─────────────┘
                                       │
                                       v
                          ┌─────────────────────┐
                          │ WORLD               │
                          │ Cesium isolation    │
                          │ (compose, shaders)  │
                          └─────────────────────┘

 Authored artifacts        Boot baseline         Fleet
 ┌──────────────┐          ┌────────────┐        ┌──────────────┐
 │ content/     │          │ show/      │        │ fleet/       │
 │ locations    │          │ Show type +│        │ REST + SSE,  │
 │ weather      │          │ applyShow  │        │ CRDT sync,   │
 │ palettes     │          │ Opening()  │        │ peer-sync    │
 │ shows        │          └────────────┘        │ effect       │
 └──────────────┘                                └──────────────┘
```

State flows through `AeroWindow`. Engines and effects are reactive but
side-effect-free outside their `untrack()` tick bodies. UI reads via
context (`useAeroWindow()`). Fleet config writes route through the CRDT
for last-writer-wins conflict resolution. Cesium is confined to `world/`.
