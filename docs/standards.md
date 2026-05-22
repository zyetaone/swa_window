# Code Standards — z-aero-window

**Purpose:** one answer for every question a contributor asks when adding code. If the answer isn't here, the answer is "copy the nearest conforming file."

**Status:** draft. Each rule has a **current state** (where the codebase stands today) and a **target**. Non-conforming code is debt — normalize when you touch the file.

**Non-goal:** this isn't a style guide (Prettier handles that). It's a SHAPE guide — what files look like, what they export, how they talk to each other.

---

## Rule 0 — Content vs Control (the foundational split)

The single biggest source of debt in this codebase is that **authored content** (locations, weather recipes, sky palettes, night-light thresholds, flight scenarios) lives inside code files alongside **control logic** (engines, compositors, shaders). A curator can't change "add Reykjavik" or "make dawn cooler" without a developer editing `.ts` files.

**Structural rule going forward:**

```
src/       → control plane: engines, compositor, shell, fleet, scene, shaders
content/   → authored artifacts: locations, palettes, weather recipes,
             shows, bundles
```

### What lives in `content/` (target state)

- `content/locations/*.ts` — one file per location, replaces the single `src/lib/locations.ts`
- `content/palettes/*.ts` — sky gradients, haze colors, car-light RGB, currently scattered across `shell/Pane.svelte`, `scene/effects/haze/HazeEffect.svelte`, `world/shaders.ts`, `scene/effects/car-lights/rules.ts`
- `content/weather/*.ts` — replaces inline `WEATHER_EFFECTS` literal in `src/lib/constants.ts`
- `content/shows/*.show.ts` — NEW primitive: a complete authored production (scene bank + cue list + defaults)
- `content/bundles/*/` — already shipped under `data/bundles/`, relocate

### What stays in `src/`

- Everything that RUNS: engines, effects, compose, shaders (the GLSL string stays code — it's a runtime artifact)
- Types and interfaces
- `constants.ts` keeps pure TUNING values (timers, thresholds, physics constants), NOT content

### The boundary test

> "Could a non-engineer curator reasonably edit this file to change the show?"

- Yes → `content/`
- No → `src/`

### Why this is Rule 0

Every other rule is easier once the boundary exists. Admin binds to `content/shows/*`, not to 12 ad-hoc `constants.ts` imports. Device loads a show on boot. New locations = add a file, not a code change. Palette tweaks = edit a file, not hunt across three components.

**Migration:** strangler-fig. Create `content/`, move things one concern at a time, keep old paths as re-exports for one release, then delete. No big-bang move.

---

## Rule 1 — State mutation has ONE public API per kind

### Current state (5+ doors)
- `applyConfigPatch(path, value, remote?)` in config-tree
- Typed setters on AeroWindow: `setAltitude`, `setTime`, `setWeather`, `setFlightSpeed`
- Direct mutation: `model.flight.altitude = n`
- Direct global-rune mutation: `config.atmosphere.clouds.density = x` (admin)
- `model.applyPatch(DTO)` flat-DTO adapter
- `setParallaxRoleWithSync(role)` special case that bypasses the dispatcher

### Target
Three doors, each with a single clear purpose:

| What you're writing | Use |
|---|---|
| A config-tree value (tunable parameter) | `applyConfigPatch('atmosphere.clouds.density', 0.5)` OR `bind:value={config.atmosphere.clouds.density}` — they're equivalent |
| Engine state (flight position, motion, director timers) | Direct mutation on the engine's own `$state` fields |
| Cross-cutting semantic operation | Typed setter on AeroWindow: `setAltitude`, `setTime`, `setWeather` |

**Deleted:** `applyPatch(DTO)` becomes internal — only director tick returns use it. Admin no longer pushes DTOs; peer-sync handles fan-out of config-tree writes.

**Rule:** if you find yourself writing a new setter on AeroWindow, ask: could the path be in the config tree? If yes, put it there and use `applyConfigPatch`. Setters are for values with SIDE EFFECTS (altitude bounds clamp, user-interaction tracking, weather-config sync).

---

## Rule 2 — Engine shape: module by default, class only when earned

### Current state (mixed)
- `FlightSimEngine` — class (250 LOC)
- `motion.svelte.ts` — module with exported `motion` object + `motionStep()` ✓
- `director/autopilot.svelte.ts` — module with `directorTick` + `directorReset` ✓
- `CesiumManager` — class (584 LOC, defensible — Cesium lifecycle is genuinely stateful)
- `AeroWindow` — class (orchestrator, composes engines)
- `RestAdminStore` — class
- `DeviceClient` — class

### Target
**Module by default.** Class only when ALL of the following are true:
1. The object has genuinely private fields that must not leak
2. The object has `$derived` chains that need to close over its own reactive fields
3. There's a real instance lifecycle (construct / destroy) that wouldn't reduce to start/stop functions
4. Public methods are called from multiple consumer contexts (not just one `tick()` caller)

**Qualifying classes today:** `FlightSimEngine`, `CesiumManager`, `AeroWindow`.
**Candidates for module conversion:** `RestAdminStore`, `DeviceClient` — both have single-consumer lifecycle + could be `create*()` factory functions returning an object of reactive `$state` + methods.

**Rule:** if you're about to write `class Foo`, write `createFoo()` first and see if it reads as well. Most of the time it does.

---

## Rule 3 — Effect layout (ONE shape)

### Current state (6 shapes for "an effect")
- `atmosphere/clouds/` — `index.ts` + `ArtsyClouds.svelte` + `CloudsEffect.svelte` + `rules.ts`
- `atmosphere/haze/` — `index.ts` + `HazeEffect.svelte`
- `atmosphere/weather/` — `Weather.svelte` + `Lightning.svelte` + `lightning.ts` (no `index.ts`)
- `atmosphere/micro-events/` — `index.ts` + `MicroEvent.svelte` + `MicroEventsEffect.svelte`
- `scene/effects/car-lights/` — `index.ts` + `CarLightsEffect.svelte` + `rules.ts`
- `scene/effects/sprite/` — `index.ts` + `effect.svelte` + `factory.ts` + `types.ts`
- `scene/effects/video-bg/` — `index.ts` + `effect.svelte` + `factory.ts` + `types.ts`

### Target

```
{name}/
  index.ts         — EffectDefinition export (id, z, when?, component)
  {Name}.svelte    — the component (PascalCase matches folder name)
  rules.ts         — OPTIONAL, only if the effect has a pure function
                      that's worth testing independently
```

**Deleted:** separate `factory.ts`, separate `types.ts` (inline in `index.ts`), double-component layouts like `{Name}.svelte` + `{Name}Effect.svelte`. If the effect has a sub-primitive (one micro-event vs the scheduler), colocate in one `{Name}.svelte` with an internal helper.

**Rule:** three files max per effect folder. If you want a fourth, justify it in the PR description.

---

## Rule 4 — File naming

### Current state
- `.server.ts` — used for Node-only files in fleet/ (mostly)
- `.svelte.ts` — used for rune-enabled TS modules
- `.svelte` — components
- Plain `.ts` — everything else

Inconsistency: `heartbeat.svelte.ts` lives in `fleet/` but handles server-side tracking. `parallax.svelte.ts` is browser-side. Some `.ts` files are Node-only but lack the suffix.

### Target

| Suffix | Meaning | Vite behaviour |
|---|---|---|
| `.server.ts` | Node-only — MUST not be imported by client | SSR bundle only |
| `.svelte.ts` | Rune-enabled module (exports `$state`, uses `$effect`) | Client + SSR |
| `.svelte` | Component | Client + SSR |
| `.ts` | Plain TS — usable anywhere | Client + SSR |

**Rule:** if it imports from `node:*` OR `multicast-dns` OR filesystem, it's `.server.ts`. No exceptions. Audit today's files and rename if needed.

---

## Rule 5 — Exports

### Current state
Mixed — some files use default, some named, some both.

### Target
**Named exports only.** No default exports.

**Exceptions (the ONLY two):**
1. Svelte components (`.svelte`) — the component itself is the default export (Svelte convention)
2. SvelteKit page/layout files — framework requires default

**`index.ts` barrels** only when ≥3 modules collapse into a domain hub (e.g. `$content/locations/index.ts`). Domains with one or two consumers don't need a barrel — folding into the nearest existing SSOT is cleaner (cf. `$lib/night/` was inlined into `utils.ts` in 2026-05).

---

## Rule 6 — Error handling philosophy

### Current state
Mix of silent catches, `console.warn`, uncaught throws, bare `{}` catches.

### Target

| Layer | Rule |
|---|---|
| SvelteKit server handlers (`+server.ts`) | `throw error(400, ...)` for client mistakes, let unexpected errors propagate to the framework's 500 |
| Internal module fetches (fleet peer POSTs, bundle fetches) | `.catch(() => {})` with a one-line comment explaining why silent is correct — best-effort LAN I/O doesn't block UX |
| Lifecycle teardowns | `try { ... } catch {}` without comment — teardown races are expected |
| Browser event handlers | Let errors propagate; the framework logs them |

**Rule:** a bare `catch {}` without a comment is a bug. Either explain why silent is correct, or remove the catch.

---

## Rule 7 — Reactivity use

### Current state
- Some `$state` fields are never read reactively (waste signal-graph slot)
- Some `$derived` wraps a single state leaf (no derivation)
- `$state.raw` used inconsistently for large objects
- `$effect` sometimes used where `$derived.by` would be cleaner

### Target

| Pattern | When to use |
|---|---|
| `$state(initial)` | Value is read in a template, `$derived`, or `$effect` |
| Plain `let` | Value is only written/read in imperative handlers (timers, event objects, rAF handles) |
| `$state.raw(obj)` | Large object replaced wholesale, mutated in place would be fine-grained but we don't care |
| `$derived(expr)` | Single-expression derivation |
| `$derived.by(() => {...})` | Multi-line derivation |
| `$effect(() => {...})` | ESCAPE HATCH — sync to external library, fire-and-forget side effects. Never for computing values. |

**Rule:** if you're about to write `$effect` that assigns to a `$state`, you're doing it wrong — use `$derived` instead. Enforced by the Svelte 5 core best practices skill.

---

## Rule 8 — Component state source

### Current state (3 patterns)
- Some components take `model` via `useAeroWindow()` context
- Some take `{ model }: EffectProps` as a prop
- Some import global rune (`config`) directly (newer admin-era components)

### Target

| Layer | Pattern |
|---|---|
| Scene effects (`atmosphere/*`, `scene/effects/*`) | Take `{ model }: EffectProps` via `$props()`. The effect runs inside the compositor, which has the model — prop over context for clarity. |
| Shell components bound to config tree (panel controls) | Import `config` directly from `$lib/model/config-tree.svelte`. No model needed. |
| Shell components needing simulation state (flight altitude, weather, motion) | Use `useAeroWindow()` context. |

**Rule:** no component mixes all three. Pick the one for its layer and stick to it.

---

## Rule 9 — Type placement

### Current state
- Core domain types in `$lib/types.ts`
- Fleet types in `$lib/fleet/protocol.ts`
- Some config-shape types anonymous in `config-tree.svelte.ts`
- Per-effect types sometimes inline, sometimes in a `types.ts`

### Target

| Type | Location |
|---|---|
| Core domain (LocationId, WeatherType, QualityMode, SkyState, SimulationContext) | `$lib/types.ts` |
| Fleet protocol (DeviceInfo, DisplayConfig, SSE event shapes) | `$lib/fleet/protocol.ts` |
| Domain-scoped internal (CesiumModelView, FlightPatch) | At the top of the module that uses it |
| Config-tree shape | Named interfaces in `config-tree.svelte.ts` (already done for `CameraShape`) |
| Effect prop types | Inline in the effect component's `<script>` — no `types.ts` file per effect |

**Rule:** if only one file uses a type, colocate it there. If two or more files use it, promote to the nearest shared parent.

---

## Rule 10 — No write-after-deletes

Less a design rule, more a session hygiene rule that's burned us repeatedly.

**Current pain:**
- Background linter/agent modifies files mid-edit
- Explore agents overclaim deletions ("X is unused") on wired code
- Cleanup estimates balloon because "wait, this was actually wired"

### Target

Before deleting ANY symbol (function, file, export):
1. `rg "SymbolName"` across `src/` and `tests/` (not just by string — by grep with word boundary)
2. Check `/api/*` routes can't construct the name dynamically
3. Check admin/shell UIs don't render conditional on the symbol's presence
4. If any of the above are ambiguous, DON'T delete — refactor to obsolescence instead

**Rule:** the Explore agent is for shape surveys, not deletion licenses. Every claimed "delete X" gets verified by human or targeted grep before execution.

---

## How to apply

1. **New code:** follows these rules or the PR gets rejected. No grace.
2. **Existing code:** normalize when you touch the file. Don't open cleanup PRs that only normalize — pair with a real change.
3. **Conflicts with existing conformant files:** this doc wins. Update the old file in a follow-up.

## How to evolve this doc

Rules get added when a pattern emerges three times. Rules get removed when enforcement costs more than the payoff. Every rule change goes through a PR review, not a side channel.

## Current debt census (one-line summary per file class that's non-conforming)

To be populated in a follow-up as the tree gets audited. First cut:
- `routes/admin/+page.svelte` — Rule 8 (pick one state source), likely Rule 3 (too many concerns in one file)
- `scene/effects/sprite/` + `video-bg/` — Rule 3 (drop factory.ts, drop types.ts)
- `atmosphere/clouds/` — Rule 3 (two components where one would do)
- `lib/constants.ts` — Rule 0 (weather literals should move to `content/`)
- `lib/locations.ts` — Rule 0 (move to `content/locations/`)
- Sky palette inline across 3 components — Rule 0 (extract to `content/palettes/`)

---

**Next step after landing this doc:** pick Rule 0 (content/control split) as the first normalize PR. Everything else follows from there.
