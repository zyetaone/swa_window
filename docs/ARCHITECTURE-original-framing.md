# Architecture — Original v1 Framing (preserved for posterity)

> The live architecture page at `/architecture` has since been amended (v1.1, 2026-05-20) to drop "Audio as missing pillar" and introduce **Time + Networking** as the real hidden pillars. This file preserves the original v1 framing for posterity.
>
> **Why the change?** An ultrathink audit found: (1) zero `AudioContext` references in `src/`, (2) the motion module's frequency knobs are *state-update rates*, not waveforms — `breathingPeriod` (multi-second) feeding a Web Audio oscillator gives sub-audible LFO, not engine drone, (3) Time has six consumers and no owner (Director, Night pipeline, Camera altitude, Sky palette, CarLights, Content/Show), (4) Networking is genuinely substantial — 10+ files in `src/lib/fleet/` — currently buried under State's CRDT bullet.

## v1 — The 7 Pillars (as originally framed)

1. **Game Loop** — built. Single RAF heartbeat, visibility-aware, error-resilient.
2. **State** — built. Flat $state tree, CRDT sync across 6 Pis, one setByPath.
3. **Rendering** — built. Z-layered compositor, Cesium WebGL → CSS effects → glass chrome.
4. **Camera** — built. Orbit + cruise, warp transitions, six motion layers.
5. **Input** — built. ONE gesture: pull the blind. Physical metaphor.
6. **Content** — built. Authorable by non-engineers. 12 locations. 23 scenarios.
7. **Audio** — "on deck." Engine drone, cabin chime, thunder; motion frequencies ready.

**Verdict (v1):** Six of seven pillars built. Audio is the missing pillar — needs an output stage on the Web Audio API.

## The v1 Audio Mapping (incorrect — preserved for context)

```
MOTION SIGNAL                    AUDIO MAPPING
─────────────────────────────────────────────────────────────────
engineVibeFreqX   7 Hz   ───▶   Oscillator  @  55 Hz drone
engineVibeFreqY  11 Hz   ───▶   Oscillator  @  83 Hz harmonic
bumpRingFreq     15 Hz   ───▶   low-pass envelope (rumble swell)
warpFactor       0 → 100 ───▶   pitch bend  +2 octaves
altitude       10 K → 65 K ──▶  crossfade  cabin  →  thin air
lightning.intensity 0→1  ───▶   thunder trigger  (delay = distance)
blind transition  open/close ▶  mechanical shade sound (foley)
```

**v1.1 audit note:** these frequency labels are *update rates of state*, not waveforms. `engineVibeFreqX` describes how often the camera-vibe term advances, not an acoustic carrier. Web Audio v2 will need a separate signal layer.

## v1.1 — The 7+2 Pillars (corrected)

The current `/architecture` page reflects this corrected framing. Audio remains a worthwhile v2 feature; the load-bearing missing pillars were Time and Networking, hiding inside other pillars.

| Pillar | Status | Notes |
|---|---|---|
| 1. Game Loop | built | + Day 6 frame-budget watchdog |
| 2. State | built | CRDT LWW + sourceId tiebreak |
| 3. Rendering | built | Single Z-source |
| 4. Camera | built | Warp transition as loading-screen-as-physical-event |
| 5. Input | built | One *passenger* gesture; everything else is operator surface |
| 6. Content | built | content/ vs src/ filesystem split |
| 7. The Night | built | 5-stage smoothstep pipeline |
| 8. **Time** | hidden | 6 consumers, no owner — Day 6 promotes |
| 9. **Networking** | hidden | REST+SSE+CRDT+mDNS — buried under State's CRDT bullet |

Audio is a v2 feature, not a v1 missing pillar.
