# Aero 2 architecture

Minimal rewrite of v1 (`../`). One slice per PR, wall-verified before the next.

> **Renderer under review.** [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md)
> proposes replacing Cesium with Three + Threlte, gated on a Denver spike.
> Everything below describes the Cesium path as it stands today; `model.ts` and
> `rules.ts` are renderer-agnostic and survive either outcome.

## Shape

Folders are **nouns from the product**. Files are **MRAX roles**, and the same
four words mean the same four things in every folder.

```
src/lib/
  world/                  what you see out of the window
    locations.ts            the worlds we fly over
    atmosphere/  model.ts  rules.ts  actions.ts
    imagery/     model.ts  rules.ts  actions.svelte.ts
    terrain/     model.ts  rules.ts  actions.ts
    lighting/              rules.ts  actions.ts
  flight/                 where the window looks, and when
    model.ts  rules.ts  actions.ts  engine.svelte.ts  clock.ts
  cesium/                 the engine, quarantined
    types.ts  attach.svelte.ts  tiles.svelte.ts  gate.ts
  window/                 composition
    scene.svelte.ts  aero-window.svelte.ts  config.ts  game-loop.ts
  experience/             what a person actually sees
    CabinWindow.svelte
  server/  assets/
```

| role           | file          | contract                                                                           |
| -------------- | ------------- | ---------------------------------------------------------------------------------- |
| **M**odel      | `model.ts`    | shapes + their canonical values. **Imports nothing.**                              |
| **R**ules      | `rules.ts`    | pure functions over the model. **Never Cesium, never runes.**                      |
| **A**ctions    | `actions.ts`  | applies state to the globe each frame. The **only** files allowed to touch Cesium. |
| e**X**perience | `experience/` | the component a person looks at                                                    |

`.svelte.ts` means the file holds runes. No `index.ts` barrels — every import
names its exact module, which is what keeps the cycle check honest.

## Not an ECS (yet)

There is exactly **one** entity — the Cesium `Viewer`. `RenderFrame` is the
component store flattened to a single row; the `Subsystem[]` in
`window/scene.svelte.ts` is the system list. An entity table would be a `Map`
with one key. Add the entity dimension when props arrive (wing, clouds, sun),
not before.

## Composition

One place, `window/scene.svelte.ts`. `Scene` is mechanism — it walks whatever
list it is given. The list at the bottom of that file is policy: what is in
this world, in the order it is applied. `experience/CabinWindow.svelte` is the
only place the engine adapter meets the scene.

## Data flow

```
window/game-loop  RAF (once scene.opened)
  → aeroWindow.tick()        wall-clock; no dt anywhere
  → aeroWindow.frame()       FlightFrame { camera, timeOfDay }   ← primaries only
  → scene.sync()             derives RenderFrame, walks the subsystems
```

The boundary carries **primaries only**. Atmosphere, imagery and night factor
are derived inside `scene`, once per frame — derived state sent across a
boundary can disagree with its inputs, and on three screens that is a tear.

## Invariants

1. Single Viewer — via the `globe()` attachment only.
2. Cesium isolation — runtime `import('cesium')` in `cesium/` and `actions.ts` files only.
3. Runes live in `.svelte.ts`; `model.ts` and `rules.ts` never hold them.
4. Offline imagery — `/api/tiles` first; remote proxy only when `NODE_ENV=development`
   (fails closed on unset, so the Pi never silently reaches the internet); Ion when the cache is empty.
5. Fleet determinism — every pose is an absolute function of wall-clock time.
   No per-process epoch, no accumulated `dt`, no `Math.random()` in the hot path.

## Verified mechanically each pass

- no import cycles
- no upward imports across the layering
- `model.ts` imports nothing; `rules.ts` never names Cesium
