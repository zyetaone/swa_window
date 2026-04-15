# Council Review: Flight Movement & Experiential Layer

*5-perspective review conducted 2026-02-16*

## Perspectives

1. **Flight Dynamics Expert** — orbit math, banking, heading, vibration
2. **Experiential Designer** — sensory stack, glass, cabin, immersion gaps
3. **Creative Director** — emotional arc, narrative, micro-events
4. **Animation & Motion Designer** — easing, timing, motion principles
5. **Technical Architect** — performance, correctness, race conditions

---

## Universal Praise

- **Elongated ellipse orbit** (2.0:0.06 ratio) is genuinely clever. Arc-length parameterization delivers sustained forward flight with brief course corrections. ~95% of flight time is straight legs.
- **Circadian sync** — using viewer's local time, not destination's — is the correct design. This is a wellbeing device, not a geography simulator.
- **Cabin wall framing** (warm gray plastic, panel seams, rivets) is essential. Without it, it's a viewport. With it, the brain accepts "airplane window."
- **10-layer CSS stack** follows physical optics of looking through an airplane window: terrain -> atmosphere -> glass -> cabin reflections.
- **Tick decomposition** (orbit, lightning, motion, altitude, randomize) is clean, composable game-loop design.

## Key Insight: The Subtlety Trap

Every individual effect errs toward subtlety (engine vibe: 0.12px sub-pixel, breathing: 1.5px, cabin reflections: 1-4% opacity). Each is defensible — "real airplane effects are subtle." Collectively, the display risks feeling **static** to a casual observer. The highest-impact improvements add *visible* motion or detail.

---

## Ranked Improvements

### Tier 1: High Impact (Implemented)

| # | Improvement | Detail |
|---|-----------|--------|
| 1 | **Wing silhouette** | Dark CSS gradient at bottom-left, shifting with bank angle. Single biggest immersion gap. |
| 2 | **Turbulence bumps** | Every 30-120s, inject a decaying oscillation (`e^(-8t)*sin(15t)*3px`). Transforms "ocean sway" into "airplane." |
| 3 | **Mid-freq turbulence chatter** | Added 2.5Hz + 3.7Hz components. Adds the constant "airplane chatter" feel. |
| 4 | **Micro-events** | Shooting stars at night, bird silhouettes by day, contrails. CSS-only, randomized 1-2/hour. Rewards the attentive viewer. |
| 5 | **Time-of-day location weighting** | Nature mornings, cities midday, dramatic golden hour, city lights at night. Creates narrative arc across the workday. |

### Tier 2: Medium Impact (Implemented)

| # | Improvement | Detail |
|---|-----------|--------|
| 6 | **Multi-frequency heading wander** | 3 incommensurate frequencies replace single sine. Never repeats. |
| 7 | **Altitude-dependent haze** | Thick below 15k ft, fading above, negligible at 40k+. |
| 8 | **Positional lightning** | Radial gradient at random XY instead of flat white fill. |
| 9 | **Sun glare tracks bank angle** | Glare slides across window during turns. |
| 10 | **Steeper rain angle** | 86-88 degrees at cruise (was 78-82). Matches 500mph airstream. |
| 11 | **Altitude-dependent turbulence** | Near-zero above 40k in clear, stronger near tropopause. |
| 12 | **Engine vibe below Nyquist** | Frequencies reduced to 17/23 Hz (were 127/97, above 30fps Nyquist). |

### Tier 3: Future (Not Yet Implemented)

| # | Improvement | Detail |
|---|-----------|--------|
| 13 | Condensation/moisture effect | CSS layer with 30-60s opacity oscillation on inner pane |
| 14 | Cloud performance budget | Reduced count/blur mode for Pi 5 deployment |
| 15 | Shuffle location cycle | Weighted random with no-repeat-within-3 constraint |
| 16 | Time-weighted weather changes | Storms rare 9-5, more common at edges of day |
| 17 | Double lightning strokes | 40% chance of return stroke at 0.3s delay |
| 18 | Unify building shader time | Pass model.time instead of separate setInterval(100) |
| 19 | Geography-aware orbit bearing | Store bearing in Location type per geography |

---

## Flight Dynamics Notes

- **Orbit period**: ~35 min per loop, each straight leg ~8-9 min
- **Effective ground speed**: ~415 m/s (1.7x real cruise). Acceptable for display.
- **Bank angle**: Max 6 degrees, smoothed at 2.5 lerp rate (~0.4s to 63% of target). Matches transport aircraft roll dynamics.
- **Breathing**: 22s period, 1.5px amplitude. Matches gentle pitch oscillation in smooth air.

## The Soul

> The code reveals a clear creative vision: a circadian companion that makes you feel like you are on an airplane, gently touring the world, with the sky matching your day. The final 20% — the wing, the bumps, the moments of surprise, and the narrative arc across a workday — is what separates "a nice demo" from "I forget this is not real."
