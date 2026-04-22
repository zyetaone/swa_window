# SWA Dynamic Window — Palette: Variant B

**Design intent**: Calm, ambient air travel. A window you forget is there — until the dusk light catches it.
Not Emirates drama. Not National Geographic sweep. Southwest: warm, human, understated.

---

## Why Variant B (not A)

Variant A was the straight brand translation: Summit Blue sky, Heart Red accents.
It read as a marketing slide — colors too saturated for a surface running 14+ hours a day.

Variant B takes the same five tokens and applies a *photometric* rather than *brand-literal* logic:
real sky chemistry at each phase of day, with brand tokens emerging naturally from that physics.
Night is near-black because night is near-black.
Dawn has lavender because pre-dawn scattering IS lavender.
Heart Red appears at dusk because that is when the atmosphere earns it.

The display is ambient furniture. Calm is the product. The palette serves calm.

---

## Tokens

| Token | Hex | Role |
|---|---|---|
| Heart Red | `#E51D34` | Accent only — dusk horizon band (~10% gradient width), never fill |
| Summit Blue | `#304CB2` | Night/dusk base; morning/noon upper sky |
| Canyon Yellow | `#F9B612` | Dawn mid, evening dominant, sun disc color |
| Desert Sand | `#E6DDB8` | Dawn horizon haze, star warm-tint reference |
| Warm White | `#FFFEF7` | Noon clouds, sun at zenith, specular |
| City Amber | `#FFB84A` | Derived — warmer than Canyon raw; city-light cast on clouds |

City Amber is not a brand token but a computed constant: Canyon Yellow shifted +15° warm,
desaturated 20%. Raw Canyon on a night background reads neon. Amber reads like a real city.

---

## Phase Token Mapping

### Night — `#050A22 → #1E2A6B`
*mood words: quiet transit, city glow, deep hold*

Upper sky: near-black (not pure `#000` — oxygen scattering even at night).
Lower sky: muted Summit Blue. Stars at full opacity.
Moon: `#FFF4D6` (Desert Sand warm-white, not clinical blue-white).
City tint on clouds: City Amber @ 55% — the warmest touch in the whole phase.

### Dawn — `#D8C4E0 → #F9B612`
*mood words: lavender pause, first warmth, soft arrival*

Upper: deep indigo fading from night.
Mid: soft lavender (pre-dawn Rayleigh scatter, real color).
Horizon: Canyon Yellow, settling into Desert Sand.
Sun disc: Canyon Yellow. Stars: 20% remnant.
The lavender is the only non-brand derived color in the system —
it is too honest to remove.

### Morning — `#304CB2 → #FFFEF7`
*mood words: clear start, open sky, crisp air*

Summit Blue at zenith, bleeding to Warm White horizon.
This is the longest phase in daylight hours — it must hold without fatigue.
Saturation is deliberately pulled back: `spriteSaturation 0.95` vs dawn's `1.20`.
Clean, not cold.

### Noon — same base, brighter ambient
*mood words: overhead light, sharp shadows, simple blue*

Identical gradient hue family to morning; slightly brighter mid-sky.
Sun: Warm White (`#FFFEF7`). Bloom minimal (`bloomScale 1.0`).
Noon on a display is the rest state — it asks nothing of the viewer.

### Evening — `#F9B612 → #E51D34`
*mood words: amber stretch, descending warmth, pre-signal*

Canyon Yellow dominant. Heart Red begins here — only in the bottom 15% of the gradient.
This is the approach path to the Heart Red moment, not the moment itself.
`bloomScale 1.85` — perceptibly wider than noon, not yet dramatic.

### Dusk — `#6A1C3F → #E51D34 → near-black`
*mood words: the wow moment, brief fire, then gone*

The only phase where Heart Red (#E51D34) is front-stage — and it is brief.
It occupies roughly the 40–62% gradient band: a narrow horizontal glow,
not a fill. Below it: dark crimson. Above: muted burgundy into Summit Blue.
`bloomScale 2.1` (vs original 2.3) — still the emotional peak, slightly less operatic.
City tint stays warm: arrival over a lit city is the final image before night reclaims it.

---

## Heart Red: Usage Contract

Heart Red (#E51D34) appears in exactly two places:
1. **Evening gradient**: bottom 15%, blended into dark crimson — an approach signal.
2. **Dusk gradient**: ~22% of gradient width centered near the 60% stop — the emotional peak.

It does NOT appear in:
- Any `moodColor` (would tint the blur band red — too aggressive at ambient viewing distance)
- Any `cloudTint` (clouds carry the warm amber family, not red)
- Any `sunGlow` (sun is Canyon Yellow at these phases)
- Night, morning, or noon

The rule: if you can read it as "alert," move the stop. The goal is "beautiful," not "urgent."

---

## Moon & Stars

Moon color is `#FFF4D6` across all phases — Desert Sand white, not standard `#E8EAF0`.
The difference is subtle on a calibrated screen; on a Pi display in an office, the warmth reads
as an organic light source rather than a screen artifact.

Stars use Desert Sand tint logic (warm at 40%) applied through `starsOpacity` ramp.
Full opacity only at night. 20% remnant at dawn. Gone by morning.

---

## City Lights Integration

Two new keys added to `PhaseConfig`:

- `cityTint` — RGBA color cast onto cloud undersides from city glow (used by `CityLightsLayer`).
  Warmest at night and dusk (55–50%). Near-zero at noon (5%) — city lights invisible in daylight.

- `cityBloom` — Subtle golden radial halo around VIIRS bright clusters.
  Always Canyon Yellow @ 3–8% opacity. Consistent warmth signal regardless of phase.
  The display runs 24/7; this is the constant low-level warmth that ties the system together.

---

## Display Fatigue Notes

This palette runs on office Pi displays, eye-level, in peripheral vision, 8–10 hours/day.

Rules applied:
- No phase uses a fully saturated hue at high brightness simultaneously.
- Evening/dusk desaturate `spriteSaturation` back from the original peaks.
- Night is dark (not "dark mode dark") — the screen should approach off at night.
- Noon is the neutral rest state, not a showpiece.

The passenger never notices a good window. That is the success condition.
