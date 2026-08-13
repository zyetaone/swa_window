# Scene Composition Codemap

**Last updated:** 2026-08-02

> **The Effect registry / Compositor architecture this document used to
> describe no longer exists.** `scene/registry.ts`, `scene/types.ts`,
> `scene/layers.ts`, `scene/effects/*`, and `Compositor.svelte` were all
> deleted. Read the history for that design; what follows is the live shape.

## Live architecture

```
+page.svelte
└── shell/pane/Pane.svelte           → layer order is local CSS, no Z table
    ├── GlobeLayer.svelte
    │   ├── CesiumViewer.svelte      → publishes activeCesium.manager
    │   └── ThreeOverlay (dynamic)   → flag-gated, world/three/*
    ├── RainGlass.svelte             → CSS water beads, raining only
    ├── Glass.svelte                 → vignette + recess rim
    └── Blind.svelte                 → useBlind composable
```

Passenger chrome (HUD, cabin clock) and operator chrome (SidePanel) mount
as siblings of Pane on `+page.svelte`, not inside the compositor stack.

Effects are plain Svelte components composed directly in `Pane.svelte`.
There is no registry, no shared `Z` constant. Each component:

- owns its internal `$state` (timers, transient visuals),
- subscribes to the game loop itself via `$effect(() => subscribe(...))`,
- reads reactive model state through `useAeroWindow()` or a narrow prop,
- mounts/unmounts through an `{#if}` in `Pane.svelte`.

Adding a DOM effect = add the component and one `{#if}` line. Adding a
geo effect = add a module under `world/` (see AGENTS.md).

## Content bundles

`lib/bundle/` is a **wire contract only** — pushed bundles have no runtime
DOM mount point. What remains and is live:

- `lib/bundle/types.ts` — `ContentBundle` shape + `isContentBundle` guard
- `lib/server/bundle/disk.ts` — server-side persistence
- `/api/content`, `/api/content/[id]`, `/api/assets` — CRUD over the above

The in-memory `bundleStore` and the Cloudflare push-poll client were deleted
on 2026-08-02 (unreachable from any entrypoint since the compositor went).
`tools/aero-push-worker/` still exists; re-wire a device-side poller and a
mount point before claiming remote bundle support again.

## Geo effect access pattern

Cesium-side effects consume the live viewer through the reactive holder:

```typescript
import { activeCesium } from '$lib/world/active.svelte';

$effect(() => {
  const mgr = activeCesium.manager;          // reactive — re-runs when Cesium is ready
  if (!mgr) return;
  const Cesium = mgr.getCesium();
  const viewer = mgr.getViewer();
  const ds = new Cesium.CustomDataSource('my-effect');
  viewer.dataSources.add(ds);
  return () => viewer.dataSources.remove(ds, true);
});
```

`CesiumViewer.svelte` sets `activeCesium.manager` after `mgr.start()` and
clears it on destroy.

## Why this shape

- **Effects own their state.** Adding one does not grow `AeroWindow`,
  `config-tree`, or `autopilot`.
- **No indirection tax.** With effects countable on two hands, a registry
  bought nothing that reading `Pane.svelte` top-to-bottom does not.
- **Pi-friendly.** Geo effects ride Cesium GPU primitives; DOM effects
  stay under a few dozen nodes and unmount when inactive.
