# Flight Path / Wing Direction — Dependency Map & Redesign Proposal

**Status:** Analysis for sign-off. No code changes proposed-as-applied.
**Date:** 2026-06-11
**Scope:** The sign-convention web linking orbit travel direction → world drift → wing facing → bank → camera look-side.

---

## 0. The user's spec (the target behavior)

1. With the current (right) wing pose, the world should drift **LEFT → RIGHT** on screen — wing sweeps **WITH** the movement.
2. When the wing flips to its mirrored pose (reverse orbit), the world should drift **RIGHT → LEFT**.
3. Bank should lean **INTO** the turn.

The problem is not any single broken number — it's that **five independent sign conventions live in five files and must all agree**, but nothing structurally couples them. Today they're hand-tuned to agree at *one* operating point and silently disagree at others (notably when `orbitDirection` flips).

---

## 1. The dependency chain (full trace)

```
                         orbitDirection  (±1)
                  flight.svelte.ts:61, set at :112  (seeded RNG, per-location)
                                  │
        ┌─────────────────────────┼───────────────────────────┬───────────────────────┐
        │                         │                           │                       │
        ▼                         ▼                           ▼                       ▼
  (A) ORBIT TRAVEL          (B) HEADING                 (C) WING MIRROR          (D) ORBIT BANK
   orbitAngle advance        velocity tangent            holder.scale.x          turnBank term
   flight:232                 × orbitDirection            Wing:271,279            Wing:325
   `orbitAngle +=             flight:250-252              `showRight =            `orbitDir *
    orbitDirection * …`       `vtx = tx*orbitDir`          orbitDir===            ORBIT_BANK_DEG(9)`
        │                     `vty = ty*orbitDir`          WING_NATURAL_DIR(1)`        │
        │                     baseHeading=atan2(…)         scale.x = ±1`               │
        │                         │                           │                       │
        ▼                         ▼                           │                       │
  lat/lon move on             heading $state                  │                       │
  the ellipse                     │                           │                       │
        │                  ┌──────┴───────────┐               │                       │
        │                  ▼                  ▼               │                       │
        │           (B1) camera look     (B2) motion.bankAngle│                       │
        │            compose.ts:639,666    motion:111-115     │                       │
        │            parallaxHeading        turnRate =        │                       │
        │            = effectiveHeading      d(heading)/dt    │                       │
        │              (base+offset)         ×0.3 → bank      │                       │
        │            Cesium heading =            │            │                       │
        │              (parallaxHd+90)%360       │            │                       │
        │            ── +90 = side-window ──     │            │                       │
        │                  │                     │            │                       │
        ▼                  ▼                     ▼            ▼                       ▼
   ════════════════ WHAT THE SCREEN SHOWS ════════════════════════════════════════════
   World terrain/clouds    Camera yaw sweeps     bank quat applied   wing pose mirrors  steady lean
   drift direction         the side view          to wing group      L↔R                into turn
                                                  (z×0.55 + x×0.18
                                                   + y×0.12)  Wing:327-330
                                  │
                       ── CameraMirror handedness flip ──
                          CameraMirror.svelte:14-16,49-50
                          Three(x,y,z) = Cesium(cx, cz, -cy)
                          → a Y↔Z swap with a sign negate =
                            an ODD (handedness-flipping) basis change.
                          +X in camera-local renders SCREEN-LEFT (Wing:65-68 admits this).
```

### Every sign convention and where it lives

| # | Convention | File:line | Sign source | Coupled to spec? |
|---|------------|-----------|-------------|------------------|
| S1 | Orbit angle advance sense | `flight.svelte.ts:232` | `orbitDirection` (±1) | Drives drift (A) |
| S2 | Velocity tangent → heading | `flight.svelte.ts:250-252` | `× orbitDirection` again | Drives camera-yaw + bank-rate |
| S3 | Camera look-side rotation | `compose.ts:666` | `+90` (magic, hard-coded) | Picks WHICH way "out the window" faces |
| S4 | Cesium roll → screen tilt | `compose.ts:668` | `-mot.bankAngle` (magic negate) | Horizon tilt direction |
| S5 | bank-pitch couple | `compose.ts:655,662` | `bankPitchCouple` (admin) | Ground/sky reveal |
| S6 | Wing mirror | `Wing.svelte:271,279,88` | `orbitDir===WING_NATURAL_DIR(1)?1:-1` | Wing facing L/R |
| S7 | Wing orbit-bank lean | `Wing.svelte:325` | `orbitDir × 9°` | Lean direction |
| S8 | Wing bank-rate lean | `Wing.svelte:326` | `motion.bankAngle` (from S2) | Lean magnitude |
| S9 | Three handedness flip | `CameraMirror.svelte:15-16,49-50` | Y↔Z swap + negate (ODD basis) | Flips every Three-space sign silently |
| S10 | Wing baked pose | `Wing.svelte:77-79` | `rotY≈1.68` etc. | Defines "natural" facing the others must match |

**Ten sign conventions. Only S1 and S2 share a variable. The other eight are independent constants/negates hand-tuned to agree at one point.**

---

## 2. Root cause

### 2.1 The core defect: `orbitDirection` fans out to FOUR consumers, each with its OWN sign treatment

`orbitDirection` is the only true "which way are we going" bit. But it reaches the four downstream systems through four *independent* code paths, each free to interpret it differently:

- **(A) drift:** `orbitAngle += orbitDirection * …` (flight:232) — moves lat/lon.
- **(B) heading:** `vtx = tx*orbitDirection` (flight:250) — a *second, separate* application of the same sign, so heading is consistent with drift **by manual duplication, not by derivation.**
- **(C) wing mirror:** `orbitDir === WING_NATURAL_DIR ? 1 : -1` (Wing:271) — a *third* independent read.
- **(D) wing lean:** `orbitDir × 9°` (Wing:325) — a *fourth* independent read.

If any one of these four is wrong-signed relative to the others, the wing reads "against movement." There is no single place that says "travel direction is X, therefore drift, heading, mirror, and lean all follow." Each is a separate hand-derivation, and three of them (B, C, D) were tuned empirically ("Sign verified empirically against the lab role switcher" — Wing:296).

### 2.2 The amplifier: the CameraMirror handedness flip (S9) makes "screen direction" un-reasoned-about

`CameraMirror.svelte:15-16` maps `Three(x,y,z) = Cesium(cx, cz, -cy)`. A Y↔Z axis swap composed with one negation is an **odd permutation with a reflection — it flips handedness.** That is why `Wing.svelte:65-68` carries the comment *"the camera-mirror swaps handedness, so +X renders screen-LEFT."*

Consequence: **no one downstream can predict the on-screen sign from first principles.** Whether `orbitDir × 9°` leans into or out of the turn depends on the parity of: the tangent sign (S2) × the look-side +90 (S3) × the handedness flip (S9) × the bank-axis convention in Three (Wing:240-243). That's a 4-term parity product computed across 3 files. Every change to any of them silently inverts the answer, and the only way anyone has validated it is by eyeballing the lab. **This is the fragility.**

### 2.3 The structural trap: the wing GLB has exactly ONE good orientation

`Wing.svelte:11-15` and the holder-mirror design (`:88-95`) document that the GLB is a *right* wing + winglet + engine nacelle whose clean out-the-window look exists at exactly `rotY≈1.68`. It **cannot be flipped by 180° yaw** without swinging the engine/underside into view — so the *only* tool available to represent "reverse direction" is the negative-X scale mirror (S6). But a negative-X scale is itself a handedness flip on the model, stacked on top of the camera-mirror handedness flip (S9). So "reverse orbit" toggles a reflection that interacts with two *other* reflections. The net facing is a product of three reflections — odd × odd × odd = odd — and whether that lands "with the movement" is, again, parity luck that was tuned at one point.

### 2.4 Why it specifically reads "against movement"

The world drift on screen is set by **S3 (the `+90` look-side) combined with S1 (orbit sense)**: the camera looks 90° to the right of travel, so as the plane advances, terrain slides across the side window in a direction determined by `+90` vs `-90`. The wing facing is set by **S6 (mirror) + S10 (baked pose) + S9 (handedness)**. These two results — drift direction and wing facing — are computed from **completely disjoint sign chains** (S3/S1 vs S6/S10/S9). They are only "supposed" to agree; nothing makes them agree. When `orbitDirection` flips, S1 flips the drift but S6 flips the wing through a different parity path, and the two can land out of phase — wing sweeping against the world.

---

## 3. The canonical model (single source of truth)

Define **one** signed scalar and derive *everything* from it with explicit, documented signs. No downstream code re-reads `orbitDirection`; they read derived booleans/signs off a single helper.

### 3.1 The SSOT

```
travelSign : -1 | +1      ===  orbitDirection   (keep the existing seeded value)
```

Plus **one** empirically-calibrated parity constant that absorbs the *fixed* handedness chain (S3 look-side × S9 camera-mirror × Three bank-axis). Call it:

```
SCREEN_DRIFT_SIGN  // +1 means travelSign=+1 drifts world LEFT→RIGHT on screen
```

This single constant is measured **once** in the lab and pinned by a test. It captures all the fixed reflections (the `+90`, the handedness flip, the bank-axis choice) so no other file has to reason about parity.

### 3.2 Derive every consumer from `travelSign` × the one calibration constant

| Consumer | Today (independent) | Canonical (derived) | Sign rule |
|----------|---------------------|---------------------|-----------|
| **Drift (A)** | `orbitAngle += orbitDirection*…` | unchanged — this IS the SSOT motion | `+= travelSign * …` |
| **Heading (B)** | `vtx = tx*orbitDirection` | unchanged — heading must equal velocity of (A), so it correctly re-uses the *same* `travelSign`. Keep. | `tx * travelSign` |
| **Wing mirror (C)** | `orbitDir===1 ? 1 : -1` | `showWithMovement = travelSign * SCREEN_DRIFT_SIGN`; `holder.scale.x = showWithMovement === +1 ? NATURAL : -NATURAL` | derived |
| **Wing lean (D)** | `orbitDir * 9` | `turnBank = travelSign * SCREEN_DRIFT_SIGN * ORBIT_BANK_DEG` | derived, same calibration constant |
| **bank-rate lean (S8)** | `motion.bankAngle` | unchanged — it already derives from heading (B), which derives from `travelSign`. Already coupled correctly. | no change |
| **Cesium roll (S4)** | `-mot.bankAngle` | leave as the *definition* of screen-tilt direction; fold its sign into the one-time `SCREEN_DRIFT_SIGN` calibration so it's consistent with the wing. | calibrated once |

**Key property:** the wing mirror (C) and the wing lean (D) now derive from `travelSign × SCREEN_DRIFT_SIGN` — the *same* expression that defines on-screen drift. So "wing sweeps with movement" and "wing leans into the turn" become **structurally true by construction**, not by coincidence. Flipping `orbitDirection` flips drift, mirror, and lean **through one shared term**, so they can never desync.

### 3.3 What `SCREEN_DRIFT_SIGN` absorbs (so nothing else has to)

```
SCREEN_DRIFT_SIGN  =  sign( S3 look-side )       // the +90 in compose.ts:666
                    × sign( S9 handedness flip )  // CameraMirror Y↔Z+negate
                    × sign( Three bank-axis )      // _bankAxis (0,0,1) in Wing
```

All three are **fixed** (they never change at runtime). Collapsing them into one measured constant means the only *runtime* variable in the whole system is `travelSign`. That is the entire point: **one runtime sign in, all behaviors out.**

---

## 4. Minimal, low-risk refactor

Five small atomic commits. Tests stay green (the orbit-determinism tests at `tests/lib/flight/flight-orbit.test.ts` only assert `orbitDirection ∈ {±1}` and cross-instance equality — none of these changes touch that). Cesium stays confined to `world/`. 3-Pi determinism is untouched (see §5).

### Commit 1 — name the SSOT, no behavior change
- In `flight.svelte.ts`, add a `get travelSign()` returning `this.orbitDirection`, and a doc block declaring it the single travel-direction SSOT. (Pure alias; zero risk.)
- Add `export const SCREEN_DRIFT_SIGN = ?` to a new tiny `src/lib/flight/screen-conventions.ts` (the natural home — framework-free, importable by both Wing and a test). Value chosen in Commit 4 after measuring.

### Commit 2 — derive the wing mirror from the canonical expression
- `Wing.svelte:271` → replace `const showRight = orbitDir === WING_NATURAL_DIR;`
  with `const withMovement = (orbitDir * SCREEN_DRIFT_SIGN) === 1;`
  and `:279` `holder.scale.x = withMovement ? WING_NATURAL_DIR_SCALE : -WING_NATURAL_DIR_SCALE;`
- Keep `WING_NATURAL_DIR` semantics but rename the *decision* from "is orbitDir natural?" to "does the wing sweep with screen movement?". One line of logic, identical output **until** `SCREEN_DRIFT_SIGN` is calibrated.

### Commit 3 — derive the orbit-bank lean from the same expression
- `Wing.svelte:325` → `const turnBank = flightMode === 'orbit' ? orbitDir * SCREEN_DRIFT_SIGN * ORBIT_BANK_DEG : 0;`
- Now mirror (Commit 2) and lean share `orbitDir * SCREEN_DRIFT_SIGN`. Structurally coupled.

### Commit 4 — calibrate `SCREEN_DRIFT_SIGN` once, in the lab
- Set `travelSign = +1` (force `orbitDirection = 1` temporarily or use the lab role switcher), observe drift. If world drifts LEFT→RIGHT with the right-wing pose showing and leaning into the turn → `SCREEN_DRIFT_SIGN = +1`. If not → `-1`. Flip `orbitDirection` and confirm the mirror + reverse-drift + reverse-lean all invert together (they now must, by construction).
- Pin the chosen value with a comment citing the parity product in §3.3.

### Commit 5 — pin it with a test + delete the dead magic
- Add `tests/lib/flight/screen-conventions.test.ts`: assert `SCREEN_DRIFT_SIGN ∈ {±1}` and a documentation-style assertion that `withMovement` and `turnBank` derive from the same `orbitDir * SCREEN_DRIFT_SIGN` term (guards against a future edit re-splitting them).
- Remove the now-obsolete "Sign verified empirically" comment at `Wing.svelte:296` for the *mirror/lean* (the heading-offset strip stays — that's §5, unrelated).

**Lines that change:** `flight.svelte.ts` (+getter, ~5 lines), new `screen-conventions.ts` (~10 lines), `Wing.svelte:271,279,325` (3 logic lines + import), new test file. No Cesium files (`compose.ts`) change — the `+90` and `-bankAngle` stay as the *definitions* that `SCREEN_DRIFT_SIGN` calibrates against. **`compose.ts` untouched = Cesium isolation untouched, lowest possible risk.**

### What this deliberately does NOT do
- Does **not** re-derive heading (B) — it already correctly re-uses `orbitDirection` and is verified by the drift it produces.
- Does **not** try to "fix" the CameraMirror handedness flip — that's load-bearing for cloud/star alignment (`CameraMirror.svelte:18-19`) and rewriting it is high-risk for zero spec benefit. We *absorb* its sign instead.
- Does **not** touch the GLB or attempt a 180° yaw flip — the mirror-scale approach stays (it's the only one the asset allows, per `Wing.svelte:88-95`).

---

## 5. The 3-Pi panorama constraint (must not break)

The wing strips the per-Pi heading offset so three Pis show **one continuous wing across the seam** (`Wing.svelte:286-303`): `headingOffsetDeg` is removed from the mirrored camera quaternion before the wing is posed, putting the wing in the shared aircraft-body frame.

**This proposal does not touch that path at all.** `travelSign`, `SCREEN_DRIFT_SIGN`, the mirror, and the lean are all **identical across all three Pis** because:
- `orbitDirection` is seeded from `daySeed() ^ hashLocationId` (`flight:107,112`) — identical on every Pi on the same day at the same location. Pinned by `flight-orbit.test.ts:20-28`.
- `SCREEN_DRIFT_SIGN` is a compile-time constant — identical everywhere.
- The mirror (C) and lean (D) read only those two → identical wing pose decision on every Pi.

The only per-Pi difference remains the yaw-offset strip (heading offset), which is orthogonal to travel sign. So each Pi still sees a different *angular slice* of the *same* posed wing → continuous seam preserved. **No regression risk to 3-Pi continuity.**

One thing to verify during calibration (Commit 4): do it in **solo** role (offset 0) so `SCREEN_DRIFT_SIGN` is measured in the base frame, then confirm in left/right roles that the seam still flows — it must, since the strip is unchanged.

---

## 6. Summary for sign-off

- **Root cause:** `orbitDirection` fans out to four consumers (drift, heading, wing-mirror, wing-lean) through four *independent* sign paths, and a handedness-flipping CameraMirror (`Three = Cesium(cx,cz,-cy)`) makes on-screen sign un-reasoned-about. The wing's facing and the world's drift are computed from disjoint parity chains that only "happen" to agree at one operating point, so flipping orbit direction desyncs them → "wing flies against movement."
- **Fix:** one runtime SSOT (`travelSign = orbitDirection`) × one measured calibration constant (`SCREEN_DRIFT_SIGN`, absorbing the fixed `+90`/handedness/bank-axis parity). Wing mirror and lean both derive from `travelSign × SCREEN_DRIFT_SIGN` — the same term that defines screen drift — so "with the movement" and "into the turn" become true by construction.
- **Risk:** minimal. 5 small commits, no `compose.ts`/Cesium changes, no CameraMirror changes, no GLB changes, no 3-Pi path changes. Tests stay green at 336; one new test pins the calibration.
- **Decision needed:** approve the canonical model (§3) and the commit plan (§4) before implementation. The single judgment call delegated to the lab is the *value* of `SCREEN_DRIFT_SIGN` (±1), measured in Commit 4.
