---
title: "Aero Window — Game Design v2 (Lean)"
type: spec
domain: aero-window
status: draft
created: 2026-05-20
tags: [aero-window, game-design, spec, experience]
---

# Aero Window v2 — Lean Game Design

Don't add systems. Add moments.

## 1. Rarity Tiers for Micro-Events

Add one field to the effect system:

```typescript
type Rarity = 'common' | 'rare' | 'epic'
```

| Event | Rarity | Frequency | Why |
|-------|--------|-----------|-----|
| Bird | Common | Every 30-90s | Life, presence |
| Contrail | Common | Every 60-120s | Shared world |
| Shooting star | Rare | 2-4x per night | "Look up!" moment |
| Lightning flash | Rare | Per storm | Power of weather |
| **Aurora** | Epic | 1x per night, high lat | "Whoa" — tell a coworker |
| **Rainbow** | Epic | After rain + sun, 30s | Hope — fleeting beauty |
| **Double bird** | Rare | 5% of bird events | "Did that just happen?" |

Implementation: `when()` predicate already exists. Just add a `rarity` field and a probability gate.

## 2. Daily Moment — One Thing Per Day

Every day at a random time, one special thing happens:

```
- A single golden cloud at sunset
- A bird that lands on the wing for 10 seconds
- A moment where the sky clears perfectly to stars
- A contrail that catches the sunrise light
```

No UI. No notification. Just a scene effect that triggers once per day per device. The player either sees it or doesn't. That's the point.

Implementation: A single `daily-moment.svelte` effect that picks from a list of 5 authored moments. One line in registry.ts.

## 3. Arrival Pause — Let It Land

When the autopilot arrives at a new location, pause for 8 seconds before the next orbit. The current dwell is too short — the player looks up and the view is already moving.

Current: `departure → transit → orbit → departure`
Proposed: `departure → transit → ARRIVAL PAUSE (8s) → orbit → departure`

During the pause: dim the HUD, slow the camera, let the terrain settle. The player arrives somewhere.

Implementation: Add `arrivalHoldMs: 8000` to the flight FSM. One constant change.

## 4. Auto-Close Side Panel

The side panel (7 controls) auto-closes after 5 seconds of inactivity. Hovering keeps it open. Touching the window glass closes it immediately.

Current: panel stays open until manually closed.
Proposed: `panel auto-dismiss: 5000ms` in config-tree.

This makes the experience **ambient again** — the controls are there when you need them, invisible when you don't.

## 5. One Daily Summary (Optional)

When the user opens the side panel for the first time each day, show a single line:

```
"Today: 3 shooting stars. A rainbow at 4:15 PM. Clear skies."
```

That's it. No dashboard. No stats. One line of text.

Implementation: Read today's event log from localStorage. Compose one sentence.

## What NOT to Do

- ❌ No achievements / badges / points
- ❌ No login or accounts
- ❌ No social sharing
- ❌ No onboarding tutorial
- ❌ No progress bars
- ❌ No sound system (separate project)

## Implementation Cost

| Feature | Files to touch | Lines | Complexity |
|---------|---------------|-------|------------|
| Rarity tiers | `types.ts`, `rules.ts`, 2 effect files | +15 lines | Trivial |
| Daily moment | 1 new effect file, `registry.ts` | +40 lines | Low |
| Arrival pause | `flight.svelte.ts` config | +3 lines | Trivial |
| Auto-close panel | `SidePanel.svelte` config | +10 lines | Low |
| Daily summary | `aero-window-persistence.ts`, `SidePanel.svelte` | +30 lines | Low |

**Total: ~100 lines of changes. Zero new dependencies.**

## Principle

The window should feel more alive, not more complicated. Each change makes the experience slightly more worth looking up for. Nothing requires the player to learn, configure, or commit.

---

## Council Verdict — 2026-05-21

Reviewed by the 4-lens game/experience council (Game Designer, Game Developer, Experience Designer, Experience Developer).

**Cross-lens insight (Experience Designer):** *"Ambient installations break when the machine's internal state becomes visible to the viewer uninvited."* This is the principle behind every "modify" call below — keep authoring tools internal, never let "EPIC EVENT!" leak into UI.

| Feature | Lenses | Ship plan |
|---|---|---|
| **#1 Rarity tiers** | ✅✅✅🟡 — Game Designer called this "the single best thing in the doc" | **Post-install.** Leader-rolled epic tier (RNG broadcast via existing `director_decision` v2). Probabilities live in `content/rarity.ts` per Rule 0, not admin sliders. Enum stays internal. |
| **#2 Daily moment** | 🟡🟡🟡🟡 — needs reframe | **Post-install, scope-narrowed.** Leader-coordinated (not 3 independent moments on 3 Pis). 8am–8pm occupied-hours window only. Triggered on **scene transitions** instead of wall-clock random time (per Game Des — 0.0001% glance hit-rate otherwise). Admin override `config.director.dailyMoment.forceToday: MomentId \| null` for launch-event coordination. |
| **#3 Arrival pause** | ✅✅🟡✅ — Game Designer "biggest perceived-quality jump" | **Pre-install (LANDED 2026-05-21).** `cruise_arrival` FSM state added with `arrivalHoldMs: 8000` default. HUD dims to 0.35 opacity during the hold ("non-negotiable" per Experience Designer). Existing motion module (bank/breathe/vibe) keeps subtle ambient motion alive so the pause reads as contemplation, not freeze. |
| **#4 Auto-close panel** | 🟡🟡🟡✅ — needs scope | **Pre-install (LANDED 2026-05-21).** `config.shell.sidePanelAutoCloseMs = 15000` (up from doc's 5000 per Game Designer — reading-and-deciding threshold). `0` disables (on-site techs flip off for debugging). Activity = pointermove inside the panel; the existing `onpointermove={resetDismissTimer}` already did this. |
| **#5 Daily summary** | ❌❌🟡❌ — three lenses skip; one would keep if poetic | **Skip as specced.** Game Developer + Experience Developer both flagged: don't build a new persistence layer for a line of text 99% of viewers never see. If revived later: derive from the existing `frame-telemetry` ring buffer (~8 LOC), operator-only, poetic language ("A rainbow at 4:15 PM. Quiet skies tonight."), never counts or stats. |

**Skipped because the principle broke:**
- Rarity badges / UI ("EPIC EVENT!") — the term is an authorship tool, not viewer vocabulary
- Wall-clock random daily moment — fires at 2am to an empty lobby
- Stats-style daily summary — sneaks complication into an ambient surface
- Per-Pi independent epic rolls — three panes become three disconnected moments

**Reversal criteria:**
- Pre-install pair (#3 + #4): if Day 2 GO/NO-GO surfaces FSM-transition jitter from the extra state, drop arrival pause; if `setTimeout(autoClose)` races with `onpointermove` resetting it under touch, drop the auto-close.
- Post-install pair (#1 + #2): only build after Pi 5 has held 30+ min @60fps with margin. If Day 6 hardening eats more time than expected, defer both to week 2 of operation.
