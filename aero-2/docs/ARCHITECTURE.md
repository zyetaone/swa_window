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
ago — while `Clouds`, `Blind`, `RainGlass`, the media stage, the director and
the whole Cesium subtree were missing. A diagram that has to be hand-updated on
every rename is a diagram that will be wrong, and a wrong map is worse than no
map. `ls` is accurate; this file holds the rules `ls` cannot show you.

Naming, so `ls` reads well:

- **`.svelte.ts` means the file holds runes.** `settings.svelte.ts` and
  `display.svelte.ts` do; the pure maths in `flight/` and `world/` does not.
- **No folder stuttering.** `world/Stage.svelte`, not `WorldStage.svelte`.
- **Each slice has one parent component** — `Display.svelte`, `Settings.svelte`
  — that owns its internals.

## 2. The invariants

Eight rules. Six are enforced by something that fails; two are not, and are
marked so, because an unenforced invariant is an aspiration.

| #   | Invariant                                                                                  | Enforced by                                                            |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | No import cycles                                                                           | `tools/check-cycles.mjs`, in `check` and `test`                        |
| 2   | The world is a pure function of (wall clock, place, `daySeed`)                             | `tests/integration.test.ts` — scans for `Math.random` and for `+= dt`  |
| 3   | Context DI: `createDisplay()` at the root, `useDisplay()` below                            | —                                                                      |
| 4   | The pure simulation modules import no renderer                                             | `tests/integration.test.ts`                                            |
| 5   | All tiles flow through `/api/tiles`; `server/tiles.ts` is the only file naming an upstream | `tests/tiles.test.ts`, `tests/regressions.test.ts`                     |
| 6   | The 3D world runs inside `<svelte:boundary>`                                               | —                                                                      |
| 7   | No barrel files (`index.ts`)                                                               | —                                                                      |
| 8   | A renderer projects the pose; it never sources it                                          | `tests/regressions.test.ts` — same second ⇒ same pose, on a cold model |

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
swappable. `import type` is exempt — it is erased at build time, which is why
the Cesium subsystem files can name Cesium types and still cost nothing.

**#8 is what makes #2 hold at the edges.** `AeroDisplay.advanceTo(wallSec)` is
the only place a pose comes from. Everything downstream — both stages, the
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

**#6 and #7 are unenforced.** Both were violated within a day of being written
down: `Clouds` ran its own WebGL context outside the boundary until 2026-08-26,
so a Three.js context loss took the page down while the identical MapLibre
failure was caught and offered a retry. If either matters enough to keep, it is
a three-line source scan alongside the two already in `integration.test.ts`.

## 3. Engines

`config.engine` picks MapLibre or Cesium; `Display.svelte` switches on it.
Cesium is reached through a runtime `import('cesium')`, so the engine you are
not running costs nothing to boot. `three` — the cloud deck and the wing — is a
static import and is always in the main chunk. That asymmetry was not a
decision; measure it on a Pi before treating it as one.

## 4. Layers, outside in

```text
Stage / CesiumStage    the world              inside <svelte:boundary>
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
- **`raster-opacity: 0` still fetches.** Outside NAIP coverage `Ground.svelte`
  _unmounts_ the USGS source rather than fading it, which is what stops several
  hundred 404s per minute.
- **A DEM source without `minzoom`/`maxzoom` reads as sea level.** MapLibre
  assumes z0–22, requests tiles the archive does not hold, never decodes one,
  and `queryTerrainElevation` returns a literal `0` — indistinguishable from
  the ocean at the call site. Declare the range every time.
- **Altitude is metres above ground, and terrain is drawn at `exaggeration`×.**
  Mixing raw and drawn metres flies the camera through mountains.
