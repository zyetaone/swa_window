# Scene Composition Codemap

**Last updated:** 2026-04-26 (phase 11 — atmosphere/ folded into scene/effects/)

## Architecture

```
+page.svelte
└── Window.svelte
    ├── CesiumViewer.svelte           → publishes activeCesium.manager
    ├── Compositor.svelte             → iterates EFFECTS + bundleStore.effects
    │   └── for each Effect:
    │       ├── if when(model) → mount component
    │       └── pass { model, params } as props
    └── window/Weather                  → backdrop CSS (rain, frost) — not a registered Effect
```

## Effect contract (`src/lib/scene/types.ts`)

```typescript
export type LayerKind = 'geo' | 'atmo' | 'window' | 'frame';

export interface Effect<TParams = undefined> {
  id: string;
  kind: LayerKind;
  z: number;                              // imported from scene/layers.ts (Z SSOT)
  when?: (model: AeroWindow) => boolean;
  component: Component<EffectProps<TParams>>;
  params?: TParams;
}
```

Effects ARE Svelte components — not plugins. They:
- Own internal `$state` (timers, transient visuals)
- Subscribe to the game loop directly via `$effect(() => subscribe(...))` if they need a tick
- Read reactive model state through the `model` prop (passed by Compositor)
- Mount/unmount cleanly — Svelte tears down `$effect`-owned timers/cleanups on unmount

## Static effects (`src/lib/scene/registry.ts`)

The registry is a 5-element `readonly Effect[]`:

| Effect | Kind | Z | `when` predicate | Owns |
|---|---|---|---|---|
| `carLights` | geo  | `Z.geo` (=0) | `hasBuildings && nightFactor > 0.15` | Cesium point entities — procedural city lights |
| `atmosphericHaze` | atmo | `Z.haze` (=0) | always | Horizon-band gradient that softens LOD seams |
| `clouds` | atmo | `Z.clouds` (=1) | `model.config.world.showClouds` | ArtsyClouds (CSS3D sprites) |
| `lightning` | atmo | `Z.lightning` (=2) | `WEATHER_EFFECTS[weather].hasLightning` | Strike timer + radial flash |
| `microEvents` | atmo | `Z.microEvents` (=3) | always | Event scheduler — stars / birds / contrails |

Adding a stock effect: drop a folder under `scene/effects/<name>/`, export a named `Effect` from `index.ts`, add one line to `registry.ts`. Z-index goes in `scene/layers.ts`.

## Dynamic effects (bundles)

Pushed via `POST /api/content`, hydrated on boot via `bundle/client.ts::hydrateFromServer()`.

```
ContentBundle JSON
  → loader.createEffectFromBundle      (dispatch on bundle.type)
  → Effect<Params>                     (with closures + component)
  → bundleStore.install                (reactive add to $state)
  → Compositor merges                  ([...EFFECTS, ...bundleStore.effects])
  → mount                              (when predicate true)
```

Bundle types live alongside their `Effect` factory:

- **video-bg** — `scene/effects/video-bg/{factory.ts, effect.svelte}`. Full-scene HTML5 video loop. Params inlined into `factory.ts` (no separate `types.ts` file as of phase 11).
- **sprite** — `scene/effects/sprite/{factory.ts, effect.svelte}`. Cesium Billboard at lat/lon, optional altitude or clamp-to-ground.

Adding a new bundle type:
1. Extend the `BundleType` union in `scene/bundle/types.ts` — exhaustiveness check forces every consumer to handle the new variant.
2. Create `scene/effects/<type>/{factory.ts, effect.svelte}`.
3. Add `case '<type>': return create<Type>Effect(bundle) as Effect;` to `bundle/loader.ts`.

## Z-layer SSOT (`src/lib/scene/layers.ts`)

```typescript
export const Z = {
  cesium: 0, geo: 0, haze: 0, clouds: 1, rain: 2, lightning: 2,
  microEvents: 3, frost: 5, wing: 7, glassVignette: 9, vignette: 10,
  glassRecess: 11,
} as const;
```

Every consumer imports from here: effect registry, `Window.svelte`, `Weather.svelte`, every `scene/effects/*/index.ts`. Geo effects render inside Cesium so the `z` value is informational only.

## Geo effect access pattern

Geo-positioned effects (`kind: 'geo'`) render inside the Cesium canvas, not the DOM. They consume the live viewer through the reactive `activeCesium` holder:

```typescript
import { activeCesium } from '$lib/world/active.svelte';

$effect(() => {
  const mgr = activeCesium.manager;          // reactive — re-runs when Cesium becomes ready
  if (!mgr) return;
  const Cesium = mgr.getCesium();
  const viewer = mgr.getViewer();
  const ds = new Cesium.CustomDataSource('my-effect');
  viewer.dataSources.add(ds);
  return () => viewer.dataSources.remove(ds, true);
});
```

`CesiumViewer.svelte` sets `activeCesium.manager = mgr` after `mgr.start()` and clears it on destroy.

## Why this shape

- **Effects own their state.** Adding an effect does not grow `AeroWindow`, `config-tree`, or `autopilot`.
- **Compositor is dumb.** It iterates and mounts. No business logic, no special cases.
- **Static + dynamic merge.** `[...EFFECTS, ...bundleStore.effects]` — same code path for stock and pushed effects.
- **Bundle JSON is dataset-shaped.** Humans author it, AI generates it, HTTP delivers it, disk caches it.
- **Pi-friendly.** Geo effects ride Cesium's GPU primitives. DOM effects stay under a few dozen nodes.
- **Z-order has one home.** `scene/layers.ts` is the single source — drift across registry / Window / Weather / individual effects is impossible by construction.
- **All effects colocated.** Phase 11 collapsed `atmosphere/` into `scene/effects/`. The registry imports its effects through relative paths from `registry.ts:./effects/*`. Discoverability is local.
