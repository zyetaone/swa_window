# Flight / Wing / Camera / Motion — Architectural Simplification

**Status:** Proposed (analysis + ADR; no code changes)
**Author:** architect
**Date:** 2026-06-11
**Scope:** `src/lib/flight/`, `src/lib/world/compose.ts` (syncCamera only), `src/lib/world/three/Wing.svelte`, `src/lib/world/three/CameraMirror.svelte`, `src/lib/flight/screen-conventions.ts`
**Relates to:** May-2026 render-graph ultrathink (ECS rejected); `screen-conventions.ts` band-aid (landed)

---

## 1. Diagnosis — the true root cause

The recurring "wing flies against the movement" bug and the whack-a-mole tuning are **not** a sign-bug. They are a **frame-of-reference bug**. There is no single aircraft body frame; instead the camera and the wing are each *independently derived from `flight.heading` by two different multi-step chains*, and then *reconciled by a measured constant*. Whenever an input flips (most often `orbitDirection`), the two chains move through different parities and disagree.

### The two derivation chains, traced

**Chain A — the camera (the seat), ending in Cesium world space:**

```
flight.heading                                   flight.svelte.ts:263  (atan2 of orbit tangent × orbitDirection)
  → camHeading            (lerp smoothing)        flight.svelte.ts:174
  → effectiveHeading(+headingOffsetDeg)           config-tree.svelte.ts:194
  → (parallaxHeading + 90) % 360   ← SIDE-LOOK    compose.ts:666
  → Cesium camera.setView{heading, pitch, roll=-bankAngle}   compose.ts:663-669
```

**Chain B — the wing, reconstructed back out of Chain A's *output*:**

```
Cesium camera (= Chain A output)
  → CameraMirror: Three(x,y,z) = Cesium(cx, cz, -cy)  ← Y↔Z HANDEDNESS FLIP   CameraMirror.svelte:49-56
       (consequence: +X renders screen-LEFT — Wing.svelte:68)
  → Wing copies group.quaternion from mirrored camera   Wing.svelte:294-295
  → STRIP per-Pi heading offset (multiply by +yawQuat)  Wing.svelte:311-314
  → mirror holder.scale.x = screenSign >= 0 ? 1 : -1    Wing.svelte:290
  → bank quaternion (z-roll + x + y), turnBank = screenSign * 13°   Wing.svelte:336-341
```

Chain B is **three reflections away from the world**: (1) the `+90` side-look baked into the camera, (2) the Y↔Z handedness flip in the mirror, (3) the `orbitDirection`-keyed `scale.x`. `screen-conventions.ts` exists *solely* to fold reflections (1) and (2) into one measured constant `SCREEN_DRIFT_SIGN` so reflection (3) can be derived from the same term as world-drift (`screen-conventions.ts:19-24, 59-61`).

### Why this is the root cause and not the symptom

- `travelSign` (the supposed SSOT) is read in **two unrelated places** that should never need a sign at all: `flight.svelte.ts:79` (where it sets the *camera's* heading via `vtx = tx * orbitDirection`, line 259) and `Wing.svelte:280` (where it re-applies the *same* direction to the wing). The wing has to *re-derive* travel direction because it was thrown away when the camera collapsed everything into one Cesium quaternion. **The information "which way is the aircraft pointing in body space" exists nowhere as a value** — it is encoded implicitly inside `flight.heading` (already +90-rotated relative to body forward) and must be reverse-engineered.
- The `+90` at `compose.ts:666` is the smoking gun: it means `flight.heading` is **not** the aircraft's nose direction — it's the *look direction* (out the side window), which is nose + 90°. So "heading" already conflates *where the plane points* with *where the passenger looks*. The wing wants the former; the camera wants the latter; both read the same field.
- The CameraMirror handedness flip (`CameraMirror.svelte:49`) is load-bearing and correct for **clouds/stars** (they're world-anchored, the flip just matches Cesium ECEF to Three). But the wing is **not** world-anchored — it's body-anchored — so routing it *through* the world→screen mirror and then *undoing* the world parts (strip heading, mirror scale) is the architectural mistake. The wing is being placed in the wrong frame and corrected back.

**Conclusion:** the class of bug is "two consumers reconstruct the same body orientation by independent reflection chains." No amount of sign-consolidation removes it; it only moves the reconciliation to one place (which `screen-conventions.ts` already did well). The bug *class* only disappears when there is **one body frame both consumers mount into**.

---

## 2. Target architecture — one aircraft body-frame SSOT

Introduce a single value: the **aircraft rigid-body transform**, owned by `FlightSimEngine`, expressed as a clean, sign-free quantity:

```
AircraftBody = {
  lat, lon, altitude,     // position on the globe (already exists: camLat/camLon/camAlt)
  noseHeadingDeg,         // TRUE compass nose direction (NOT +90 look direction)
  pitchDeg,               // body pitch
  bankDeg,                // body roll (from motion, single signed value)
}
```

Everything else becomes a **pure placement** in that frame — an offset, never a sign fixup:

```
                       ┌─────────────────────────────┐
                       │   AircraftBody (SSOT)        │
                       │   nose, pitch, bank,         │
                       │   lat/lon/alt                │
                       └──────────────┬──────────────┘
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        │                             │                              │
   CAMERA (seat)                 WING (mount)                  WORLD DRIFT
   = body                        = body                        = body nose
   + seatLook(+90)               + fixed fuselage mount         advances → terrain
   + perPiYaw(+offset)             (right wing = +X body)        slides; clouds/
   + pitch couple                + bankDeg (shared)             stars world-anchored
   → Cesium camera               → Three group                  (already correct
   (world/compose.ts)            (placed in BODY frame,         via CameraMirror)
                                  NOT camera frame)
```

### How each magic sign disappears

| Today (magic sign / reflection) | File:line | Under body-frame SSOT |
|---|---|---|
| `vtx = tx * orbitDirection` to re-sign heading | `flight.svelte.ts:259-261` | **Gone.** `noseHeadingDeg` is computed once as the true tangent direction; `orbitDirection` only chooses which way `orbitAngle` advances (line 241). Nose follows velocity automatically. |
| `(parallaxHeading + 90)` side-look | `compose.ts:666` | **Becomes explicit seat offset.** Camera = `body.noseHeadingDeg + SEAT_LOOK_DEG (+90)`. Still a `+90`, but now it's a *named seat geometry constant*, not a hidden conflation inside "heading". |
| `travelSign` re-read in the wing | `Wing.svelte:280` | **Gone.** The wing mounts at fixed `+X` in the body frame and inherits `noseHeadingDeg`. It points where the plane points — no travel re-derivation. |
| `holder.scale.x = screenSign >= 0 ? 1 : -1` mirror | `Wing.svelte:290` | **Gone.** A right wing mounted in the body frame already swings correctly when the body yaws; there is no "reverse orbit" pose to mirror because the wing is rigid to the body, not to the screen. |
| `turnBank = screenSign * 13°` orbit lean | `Wing.svelte:336` | **Becomes `body.bankDeg` directly.** Bank is one signed value owned by motion + the orbit-lean term, consumed identically by camera roll (`compose.ts:668`) and wing. No screen parity. |
| strip per-Pi heading offset | `Wing.svelte:308-314` | **Gone.** The wing is placed in the *body* frame, which by definition excludes the per-Pi yaw. Each Pi's camera (which DOES include the yaw) looks at the shared body-framed wing and sees its own slice — continuity for free, no strip-and-re-add. |
| `SCREEN_DRIFT_SIGN` reconciliation | `screen-conventions.ts` | **Reduced to ONE unavoidable calibration:** the CameraMirror handedness (`Cesium(cx,cz,-cy)`) is a real physical fact of two engines' axis conventions. It survives as a single constant *in the mirror's frame definition*, not as a parity the wing has to know about. The wing never sees it because the wing lives in body space, which is defined *before* the mirror. |

**The one calibration that legitimately remains:** the Cesium↔Three handedness flip in `CameraMirror.svelte:49`. That is a genuine coordinate-system fact (Cesium Z=North, Three Y=up), not a bug. It stays — but it stays *contained in the mirror*, affecting only world-anchored overlays (clouds, stars) which is exactly where it's correct. The wing stops depending on it.

### Why this is NOT full ECS (reconciles the May-2026 rejection)

The May ultrathink rejected ECS as "too heavy" — entities, components, systems, a scheduler, a query layer. This proposal adds **none of that**. It adds **one struct and one frame convention**:

- It keeps the existing class (`FlightSimEngine`) and module (`motion`) — no system/scheduler rewrite.
- It keeps the tick pipeline, `untrack()` hot paths, and the patch DTO boundary unchanged.
- It is a **data-shape consolidation** (publish a body transform) + a **placement reframe** (wing reads body, not camera), not an architectural paradigm.

The game-designer "single body frame" framing is the *lightweight win the ECS proposal was reaching for* — a shared world transform — without the entity/system machinery. It captures ~80% of the "one source of truth for spatial state" benefit at ~5% of the migration cost.

---

## 3. Build-vs-keep — honest call

### Option A — Keep current + accept `screen-conventions.ts` as the answer
**Effort:** 0. **Risk:** 0. The band-aid genuinely works: it collapsed four sign sites to one measured constant, and the wing now sweeps with the world *by construction* (`screen-conventions.ts:16-24`). If no new consumer is added and no new mode (cruise/scenario travel direction) needs a sign, this is *fine and shippable today*.

**The catch:** the moment a *third* spatial consumer appears (e.g. a second visible wing, a contrail, a cabin-shadow, a tail-fin, or cruise mode wanting its own travel sign per `flight.svelte.ts:79` comment), it must independently learn the same three-reflection parity. The bug class is dormant, not gone.

### Option B — Full body-frame SSOT migration
**Effort:** ~6 small commits (below). **Risk:** medium — touches the camera-facing heading semantics, which is the most visually load-bearing code; a wrong sign here is immediately visible on every screen.

**Payoff:** the bug *class* is eliminated. New spatial consumers become trivial (mount in body frame, done). The `+90` becomes a named seat constant. `travelSign`, `screenTravelSign`, the wing mirror scale, and the heading-strip all delete.

### Recommendation
**Keep current for the SWA ship (Option A).** Then do Option B as a *post-install* consolidation, executed as the incremental path below so it's never a big-bang and each commit is independently shippable. The first two commits (below) are pure additions with zero visual risk and can land *before* the ship as groundwork without changing a pixel.

---

## 4. Incremental migration path (no big-bang, tests green each step)

Each commit compiles, keeps 341 tests green, and leaves the kiosk shippable.

> **★ SAFE TO START NOW (pre-ship, zero visual change):** commits 1 and 2.

**Commit 1 ★ — Publish the body transform (additive, no consumer changes).**
Add `noseHeadingDeg` getter to `FlightSimEngine` = current `flight.heading` (the look direction) **minus** the seat-look 90°, so it expresses true nose. Add a `body` accessor returning `{lat, lon, alt, noseHeadingDeg, pitchDeg, bankDeg}`. Nothing reads it yet. Add unit tests pinning `noseHeadingDeg` across both `orbitDirection` values. *Zero visual change — pure new surface.*

**Commit 2 ★ — Name the seat-look constant.**
Replace the literal `+ 90` at `compose.ts:666` with `+ SEAT_LOOK_DEG` (=90), defined next to `effectiveHeading`. Document it as "passenger looks out the side, nose+90." *Pure rename, byte-identical behavior.*

**Commit 3 — Camera derives from body.**
Change `compose.ts:syncCamera` to compute its heading as `body.noseHeadingDeg + SEAT_LOOK_DEG + headingOffsetDeg` instead of `effectiveHeading(camHeading) + 90`. Since commit 1 defined `noseHeadingDeg = heading - 90`, this is algebraically identical — verify the camera doesn't move (screenshot diff). *Establishes the camera as a body consumer.*

**Commit 4 — Wing mounts in body frame (the keystone).**
Stop copying the *camera* quaternion in `Wing.svelte:294-295`. Instead build the wing's group orientation from `body.noseHeadingDeg` + `body.bankDeg` directly (still via CameraMirror's handedness for the world→screen mapping, but constructed from body values, not reconstructed from camera). Delete the heading-strip (`Wing.svelte:308-314`) and the `scale.x` mirror (`Wing.svelte:290`) — the rigid body wing needs neither. Calibrate the *one* remaining handedness constant once in the lab (reuse `__wing.flipDriftSign`). *This is where "flying weird" is structurally fixed. Highest risk commit — do alone, screenshot all three roles.*

**Commit 5 — Collapse `travelSign` / `screen-conventions.ts`.**
With the wing no longer re-deriving travel direction, delete `screenTravelSign`, `SCREEN_DRIFT_SIGN`, and the `travelSign` getter (`flight.svelte.ts:79`). `orbitDirection` stays purely as the orbit-angle advance sign (`flight.svelte.ts:241`). Bank lean (`Wing.svelte:336`) reads `body.bankDeg`. *Net deletion; the bug class is now gone.*

**Commit 6 — Fold orbit-lean bank into the body.**
Move the `ORBIT_BANK_DEG` orbit-turn lean (`Wing.svelte:335-336`) out of the wing and into `motion`/body so `bankDeg` is the *complete* signed bank that camera roll and wing share identically. *Camera and wing now provably bank together.*

If risk appetite drops mid-way: stopping after **commit 3** already names the seat constant and proves the camera-from-body path with zero behavior change — a clean, valuable resting point. Commits 4–6 are the actual cleanup and can wait indefinitely.

---

## 5. Interaction with the SWA Hyderabad ship deadline

**Do not run commits 3–6 before the install.** The camera-facing heading is the single most visually load-bearing path in the product, and commit 4 deliberately rewrites how the wing is oriented — exactly the kind of change that wants hardware-in-the-loop validation on the real 3-Pi panorama, not a pre-ship scramble. `screen-conventions.ts` already makes the current build correct and shippable; the wing sweeps with the world today. Commits 1–2 are pure groundwork (a new getter, a renamed constant, zero pixels moved) and *may* land before the ship if it helps morale, but carry no shipping value on their own. **Verdict: ship on the band-aid; do the body-frame consolidation as the first post-install architecture pass, on hardware, where commit 4's calibration can be verified against the real seam rather than the lab role-switcher.**
