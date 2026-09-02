# Aero 2 Architecture

Three Raspberry Pi 5s stand side by side behind one window. They exchange
nothing. Everything below follows from that.

> MapLibre is the canonical renderer as of 2026-08-25. See
> [ADR-005](../../docs/ADR-005-aero-2-threlte-renderer.md).

## 1. The shape

Two feature slices under `src/lib/`, plus server-only tile streaming:

```text
settings/   the config SSOT and the operator drawers
display/    the kiosk window — world/, flight/, cabin/, media/
server/     the offline tile proxy; imports nothing from the two above
```

**There is deliberately no file listing here.** The previous version of this
document enumerated the tree, and by the time anyone read it the tree had
`Relief.svelte` and `Air.svelte` in it — files that were renamed a long time
ago — while `Clouds`, `Blind`, `RainGlass`, the media stage and the director
were missing. A diagram that has to be hand-updated on
every rename is a diagram that will be wrong, and a wrong map is worse than no
map. `ls` is accurate; this file holds the rules `ls` cannot show you.

Naming, so `ls` reads well:

- **`.svelte.ts` means the file holds runes.** `settings.svelte.ts` and
  `display.svelte.ts` do; the pure maths in `flight/` and `world/` does not.
- **No folder stuttering.** `world/Stage.svelte`, not `WorldStage.svelte`.
- **Each slice has one parent component** — `Display.svelte`, `Settings.svelte`
  — that owns its internals.

## 2. The invariants

Nine rules. Seven are enforced by something that fails; two are not, and are
marked so, because an unenforced invariant is an aspiration.

| #   | Invariant                                                                                  | Enforced by                                                                                    |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 1   | No import cycles                                                                           | `tools/check-cycles.mjs`, in `check` and `test`                                                |
| 2   | The world is a pure function of (wall clock, place, `daySeed`)                             | `tests/integration.test.ts` — scans for `Math.random` and for `+= dt`                          |
| 3   | Context DI: `createDisplay()` at the root, `useDisplay()` below                            | —                                                                                              |
| 4   | The pure simulation modules import no renderer                                             | `tests/integration.test.ts`                                                                    |
| 5   | All tiles flow through `/api/tiles`; `server/tiles.ts` is the only file naming an upstream | `tests/tiles.test.ts`, `tests/regressions.test.ts` — templates AND every file under `display/` |
| 6   | The 3D world runs inside `<svelte:boundary>`                                               | —                                                                                              |
| 7   | No barrel files (`index.ts`)                                                               | —                                                                                              |
| 8   | A renderer projects the pose; it never sources it                                          | `tests/regressions.test.ts` — same second ⇒ same pose, on a cold model                         |
| 9   | Every page route renders, and the kiosk is actually flying                                 | `tools/smoke-routes.mjs` (`bun run smoke`)                                                     |

**#2 is the product.** No accumulated `dt`, no per-process epoch, no unseeded
randomness anywhere the window can see. Both failure shapes have bitten:
the director rolled an unseeded 2–5 minute interval AND integrated a clamped
`dt`, so three panes sat over three different cities; the cloud deck integrated
frame deltas in three places while its own docstring claimed determinism. The
fix in both cases was the same — derive from the wall clock, remember nothing.
Per-pane randomness is allowed only where it is genuinely per-pane and cosmetic
(cabin audio, rain on this pane's own glass), and that list lives in the test.

**#4 is narrower than it sounds, on purpose.** It does not say "only `world/`
touches MapLibre" — `flight/MiniMap.svelte` renders a map and needs one. It
says the _pure_ modules stay pure: `flight-path`, `view`, `parallax`,
`atmosphere`, `sun`, `settings`, `locations`. That layer is what a second
renderer reuses unchanged, and what the suite can exercise without a GPU. One
renderer import in any of them and a swappable engine quietly stops being
swappable. `import type` is exempt — it is erased at build time, so a renderer
bridge can name its engine's types and still cost the pure layer nothing.

**#8 is what makes #2 hold at the edges.** `AeroDisplay.advanceTo(wallSec)` is
the only place a pose comes from. Everything downstream — the stage, the
clouds, the wing, the rain, the HUD — reads `display.view` and draws it. The
moment a component reaches for `Date.now()` itself it has become a second
clock, and two clocks on one pane cannot be made to agree by making each of
them deterministic: the storm's lightning ran its own RAF sampling its own
`Date.now()`, so the flash landed on a millisecond the drawn frame was never
derived from. Determinism is a property of the graph, not of each node.

The one thing a renderer is allowed to source is terrain, because only it has
the DEM — and that is exactly why the clearance policy lives in
`world/clearance.ts` and reports whether the sample was real. See the
diagnostics readout in the admin drawer; a `0% sampled` reading means the
window is flying over a mean, not over ground.

**#9 is the only check that loads a page.** Everything above reasons about
source or calls a function; none of it mounts a route, so a component that
throws during init is green in `check`, green in the suite, and serves an empty
`<body>` with a 200. The parent repo shipped `/admin` in exactly that state with
489 passing tests. `curl` cannot see it either — `ssr = false` means the static
shell returns 200 whether or not the app boots inside it, so the guard on
`/admin` has to be checked on `__data.json`.

It also asserts the pose CHANGED between two samples, because a frozen window
is the failure that survives every other check: a stalled render loop leaves a
live canvas holding its last frame at a plausible altitude with a clean
console, which is a photograph of an aeroplane window and indistinguishable
from the product in a screenshot. Both assertions were verified by breaking the
code they cover — an init throw in `/admin`, and a disabled
`requestAnimationFrame` in `Stage` — and confirming the run goes red.

`bun run smoke` runs the built server with `NODE_ENV` UNSET, which is the Pi's
own configuration: the dev-only remote tile fallback is off, so the run sees
the real offline archive instead of quietly proxying NASA and passing on any
machine with internet.

**#6 and #7 are unenforced.** Both were violated within a day of being written
down: `Clouds` ran its own WebGL context outside the boundary until 2026-08-26,
so a Three.js context loss took the page down while the identical MapLibre
failure was caught and offered a retry. If either matters enough to keep, it is
a three-line source scan alongside the two already in `integration.test.ts`.

## 3. Engines

**There is one.** MapLibre GL, mounted unconditionally by `Display.svelte`.

There were two until 2026-08-31. `config.engine` switched between MapLibre and
Cesium, and Cesium came in through a runtime `import('cesium')` so the engine
you were not running cost nothing to boot. It was deleted rather than fixed:
no terrain provider was ever set, so it flew the regional mean — below the
local peak at five of eleven locations — and it named two upstream tile hosts
directly, which invariant 5 forbids and the scan of the day could not see.
`../docs/ADR-005` proposes Threlte as the eventual second renderer; Cesium was a
third option that was nobody's plan.

What survives the deletion is the shape, and it is worth keeping if a second
renderer arrives: the bridge owns the engine, `import type` keeps the pure
layer clean, and a source scan asserts the new stage advances the clock —
mounting a stage is not the same as driving one.

`three` — the cloud deck and the wing — is a static import and is always in the
main chunk. That asymmetry was not a decision; measure it on a Pi before
treating it as one.

## 4. Layers, outside in

```text
Stage                  the world              inside <svelte:boundary>
Clouds                 the deck               inside <svelte:boundary>
Wing                   the airframe           z 5
RainGlass, Frame, Blind  the cabin            z 10
MiniMap, Hud           instruments
Settings               operator drawers       z 100 (a snippet, injected)
```

Component visibility is gated in exactly one place: the config knob the
component itself reads. `Display.svelte` briefly had five boolean props
duplicating those knobs, of which its single caller passed one.

## 5. Known-sharp edges

- **Tile URL shape is load-bearing:** `/api/tiles/xyz/{layer}/{z}/{x}/{y}.{ext}`.
- **The tile archive lives in `data/`, never `static/`.** Under `static/` Vite
  copies and brotli-compresses all ~56k files into `build/` on every build
  (3.5 min, 11 GB) AND the adapter serves them directly, so
  `GET /tiles/terrain.pmtiles` answers 200 without the path guard, the symlink
  check or the Range logic — which quietly makes invariant 5 optional.
- **A present archive is not a working one.** `terrarium/` is build INPUT for
  `pack-pmtiles`; the kiosk never requests it. A pack holding only terrarium
  renders a white sheet, and the health endpoint called that `ok` for as long
  as it counted directories rather than asserting named assets. If you add a
  raster source, add it to `REQUIRED_TILE_ASSETS` in `server/tiles.ts` or
  nothing will ever tell you it is missing.
- **`raster-opacity: 0` still fetches.** A faded-out source keeps requesting
  tiles at full rate; only unmounting stops it. `Ground.svelte` gates the VIIRS
  night-lights source behind `{#if nightLightOpacity > 0.01}` for that reason —
  it used to do the same for a USGS/NAIP layer that was deleted on 2026-08-26,
  where it was worth several hundred 404s a minute outside US coverage.
- **A DEM source without `minzoom`/`maxzoom` reads as sea level.** MapLibre
  assumes z0–22, requests tiles the archive does not hold, never decodes one,
  and `queryTerrainElevation` returns a literal `0` — indistinguishable from
  the ocean at the call site. Declare the range every time.
- **Altitude is metres above ground, and terrain is drawn at `exaggeration`×.**
  Mixing raw and drawn metres flies the camera through mountains.
