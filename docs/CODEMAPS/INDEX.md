# Aero Window Codemap

**Last Updated:** 2026-08-12

## Quick Navigation

| Document | Scope |
|----------|-------|
| [File Inventory](files.md) | Source layout — folder by folder |
| [Architecture](architecture.md) | Layer diagram, data flow, key interfaces |
| [Scene composition](scene.md) | Live layer composition in Pane.svelte + bundle wire contract |
| [Content API](content-api.md) | Bundle CRUD + LAN cache + remote push |
| [Security boundaries](security.md) | Trust zones, validation, CSP, sensitive data |

> Authoritative agent instructions: `AGENTS.md`. Full architecture: `docs/ARCHITECTURE.md`.
> CODEMAPS summarise per-concern slices and can lag — prefer AGENTS when they disagree.

## Architecture at a glance

```
                         DEPENDENCY LAYERS

 ┌─────────────────────────────────────────────────────┐
 │  ROUTES                                             │
 │  +layout.ts (ssr=false) → +page.svelte → admin/    │
 │  /playground (lab) · /wiki                         │
 └──────────────┬─────────────────┬───────────────────┘
                │                 │
                v                 v
 ┌─────────────────────┐  ┌──────────────────────────┐
 │  MODEL              │  │  SHELL                   │
 │  AeroWindow + ctx   │  │  pane/  passenger/       │
 │  config tree (SSOT) │  │  operator/  window/      │
 │  CRDT LWW store     │  │  dual-tree panel/*       │
 └───┬───────┬─────────┘  └──────────┬───────────────┘
     │       │                       │
     v       v                       v
 ┌────────┐ ┌──────────┐  ┌─────────────────────────┐
 │FLIGHT  │ │DIRECTOR  │  │ BUNDLE                  │
 │orbit + │ │autopilot │  │ wire types + disk store │
 │cruise  │ │scenarios │  │ (no runtime mount)      │
 │motion  │ │show open │  │ DOM effects → shell/    │
 └────────┘ └──────────┘  └────────────┬────────────┘
                                       │
                                       v
                          ┌─────────────────────┐
                          │ WORLD               │
                          │ Cesium (compose) +  │
                          │ Three overlay (flag)│
                          └─────────────────────┘

 Authored artifacts        Fleet
 ┌──────────────┐          ┌──────────────┐
 │ content/     │          │ fleet/       │
 │ locations    │          │ REST + SSE   │
 │ weather      │          │ peer-sync    │
 │ palettes     │          │ parallax SSOT│
 │ shows        │          │ CRDT stamps  │
 └──────────────┘          └──────────────┘
```

### Operator dual-tree (kiosk + admin)

```
panel/*  →  usePanelConfig()
              ├── kiosk: model.applyConfigPatch (telemetry + SSE)
              └── admin: applyConfigPatch + startPeerSync(PEER_SYNC_PATHS)
```

Shared ambient panels: `FlightControls`, `AtmosphereControls`, `LightingControls`
(Lighting + Display sections). Scene one-shots stay admin-local drafts.

State flows through `AeroWindow` on the kiosk. Admin never mounts AeroWindow.
Cesium stays in `world/`; Three overlay under `world/three/`.
