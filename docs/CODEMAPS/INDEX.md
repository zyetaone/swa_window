# Aero Window Codemap

**Last Updated:** 2026-04-14

## Quick Navigation

| Document | Scope |
|----------|-------|
| [Architecture](architecture.md) | Layer diagram, data flow, component tree, state ownership, key interfaces |
| [File Inventory](files.md) | Every source file with line count, exports, and purpose |
| [Security Boundaries](security.md) | Trust boundaries, validation points, auth model, CSP, sensitive data |

## Codebase Stats

- **Total source files:** 44
- **Total lines:** ~8,100
- **Languages:** TypeScript, Svelte 5, GLSL
- **Stack:** SvelteKit 2, Cesium.js, Tailwind CSS v4, Bun

## Architecture at a Glance

```
shared/          (leaf — types, constants, utils, locations, protocol)
    |
engine/          (pure simulation — zero DOM)
    |
app-state        (coordinator — AeroWindow + context DI)
    |
ui/ + routes/    (presentation + side-effects)
    |
services/        (side channel — persistence, fleet WS)
```

All state flows through `AeroWindow`. Engines are pure. UI reads via Svelte context (`useAeroWindow()`). Fleet commands validated at the display boundary.
