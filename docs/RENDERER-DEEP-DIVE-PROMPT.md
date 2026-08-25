# Deep-dive prompt — Cesium vs Three.js vs MapLibre for Aero Window

Paste the block below into a fresh session (or hand it to a research agent).
Read `docs/WHAT-WE-ARE-DOING.md` first for context.

**Why this prompt is shaped the way it is:** this project has now chosen a
renderer three times — Cesium (ADR-001), Three.js (ADR-004/005), MapLibre
(promoted 2026-08-25) — and has **never once run the Pi 5 measurement** that
every one of those ADRs named as its own gate. ADR-004's P8 gate has been open
since June 2026. The failure mode is not lack of analysis. It is an excess of
analysis substituting for a measurement that takes an afternoon. The prompt is
built to refuse that substitution.

---

## THE PROMPT

> You are evaluating the renderer choice for **Aero Window**, a digital airplane
> window running on three Raspberry Pi 5s in headless Chromium kiosk mode,
> forming one continuous panoramic view. Read `docs/WHAT-WE-ARE-DOING.md`,
> `docs/ADR-001`, `ADR-004`, `ADR-005`, `ADR-006`, and both `AGENTS.md` files
> before forming any opinion.
>
> ### Ground rules
>
> 1. **Distinguish measured from asserted.** Every claim you make must be tagged
>    `[measured]`, `[cited]` (with the source), or `[inferred]`. This codebase's
>    ADRs contain confident, wrong assertions — ADR-005 records that MapLibre's
>    camera API was "asserted wrongly during evaluation" (someone claimed
>    `FreeCameraOptions`, which is Mapbox, not MapLibre). Do not add to that pile.
> 2. **Prefer a number you can obtain over an argument you can construct.** If a
>    question can be settled by running something, say so and say how, rather
>    than reasoning toward an answer.
> 3. **The product is a feeling, not a frame rate.** "Does it look and feel like
>    an airplane window across an office, for an hour" outranks every technical
>    metric — but it does not excuse skipping the metrics.
> 4. **Do not recommend a rewrite as your opening move.** This codebase has had
>    three. Weight "what is the smallest experiment that would change my mind"
>    above "what would I build from scratch."
>
> ### Part A — establish the real constraints (facts, not preferences)
>
> For each of **CesiumJS**, **Three.js (+Threlte)**, and **MapLibre GL JS**,
> answer with evidence:
>
> 1. **Pi 5 reality.** What is actually known about each under Chromium on a
>    Pi 5 with `--use-gl=angle --use-angle=gles`? VideoCore VII, 512 MB CMA,
>    GLES 3.1. Find real reports, benchmarks, or bug threads — not vendor claims.
>    Where nothing exists, say "unknown, and here is how to measure it in an
>    afternoon."
> 2. **Memory.** ADR-001 cites Cesium at 200–400 MB RAM and ~3.5 MB cold bundle;
>    ADR-005 targets ~40 MB (the PMTiles figure) and ~500 KB. Are these numbers
>    real, current, and comparable? Three panes × texture budget: 4096² RGBA is
>    67 MB uncompressed — what does KTX2/Basis actually change on VideoCore VII?
> 3. **The camera.** Aero Window puts the eye at a true altitude and aims it at a
>    ground point at a fixed depression angle. Compare Cesium's geodetic camera,
>    a hand-built Three camera, and MapLibre's
>    `calculateCameraOptionsFromTo(from, altFrom, to, altTo)`. Which genuinely
>    position by altitude rather than faking it through zoom? What breaks at
>    400 m AGL vs 13 000 m?
> 4. **The terrain material question — the crux.** ADR-005 claims MapLibre
>    *drapes rasters over* terrain rather than giving the mesh a material, so
>    there is no fragment shader sampling base + detail + night-emissive and
>    blending by distance. **Verify this against MapLibre 6.x**, not older docs.
>    Does the custom-layer API, `setTerrain`, or any 2025–2026 addition change
>    it? If the claim still holds, what *exactly* is unreachable, and how much
>    does that matter for two unwired properties (`deckOpacity`, night emissive)?
>
> ### Part B — attack the current decision
>
> 5. **Steelman keeping MapLibre.** It solved the blur problem with hillshade
>    instead of imagery, killing a multi-day bake pipeline. It ships at 2.7 MB.
>    Its tile/DEM/projection problems are solved. What is the strongest case that
>    the two missing layers are worth *less* than that simplicity?
> 6. **Steelman returning to Cesium.** It shipped, it works, terrarium elevation
>    landed in 96 lines, and four ADRs of operational knowledge assume it. What
>    is the strongest case that deleting it was premature?
> 7. **Steelman the Three.js bet.** Full shader control over what *is* the
>    product. But ADR-005 names the real risk precisely: *"the bake pipeline is
>    the real cost, not the rendering… misalignment reads as a bug and cannot be
>    fixed at runtime."* Is that risk days or weeks? What would make it days?
> 8. **Steelman the hybrid.** v1 already runs Cesium + a Three overlay with the
>    camera pulled each frame, and ADR-006 cites an independent production case
>    that hit a render-to-texture trap doing this. Is MapLibre + a thin
>    orientation-only Three overlay (clouds/sky only, no ground) genuinely
>    different from that trap, or the same mistake wearing a new hat?
>
> ### Part C — the ladder ADR-006 started
>
> 9. For each missing layer — **clouds**, **believable sky**, **night city
>    lights** — work the cheapest rung first and stop at the first that suffices:
>    (a) a prop already present and unset, e.g. MapLibre `<Sky atmosphere-blend>`;
>    (b) one more raster layer, e.g. GIBS VIIRS at `nightFactor` opacity;
>    (c) CSS/DOM over the canvas — note that v1's *shipped* cloud technique was
>    CSS 3D and beat GLSL noise in a prior A/B;
>    (d) a custom WebGL layer inside MapLibre's context;
>    (e) a second renderer.
>    For each, state what would prove the rung insufficient. Be specific about
>    where CSS clouds break down: parallax at altitude, and three-pane continuity
>    across physical bezels.
>
> ### Part D — deliverables
>
> 10. **A decision table**: rows = the four options (Cesium, Three, MapLibre,
>     MapLibre+overlay); columns = look ceiling, Pi 5 risk, memory, offline fit,
>     licence fit, migration cost, reversal cost. Every cell tagged
>     `[measured]` / `[cited]` / `[inferred]`.
> 11. **The single afternoon experiment** that would settle the most uncertainty
>     per hour spent. Name the exact scene, place, duration, panel configuration,
>     and the numbers to capture. If that is the long-overdue Pi 5 side-by-side,
>     say so and specify it precisely enough to execute without further thought.
> 12. **Falsifiable reversal criteria** for whatever you recommend — the form
>     ADR-005 used: "return to X if any of these hold."
> 13. **Explicitly list what you could not determine**, and what it would take.
>
> ### Anti-goals
>
> - Do not produce a general "Cesium vs Three vs MapLibre" comparison. Everything
>   must be conditioned on: one place at a time, ~10 km altitude, oblique view,
>   500 km horizon cap, **no globe ever needed**, three fixed portrait panes,
>   fully offline, open data only, Pi 5 class hardware.
> - Do not treat bundle size as a proxy for Pi 5 performance. They are not the
>   same axis and this project has conflated them before.
> - Do not restate ADR content back as findings. Add evidence or challenge it.
> - If your honest conclusion is "the current stack is fine and the real gap is
>   that nobody has measured anything on hardware," **say that plainly.** That is
>   a valid and possibly correct answer.

---

## Suggested follow-ups

After the main analysis:

- *"Design the Pi 5 side-by-side so a non-expert can run it and get a number:
  exact commands, what to record, what counts as pass."*
- *"For three portrait panes across an office, what does 'looks like a window'
  demand that a single desk monitor never reveals? Bezel continuity, angular
  size, viewing distance, and the fact that calm is a property of duration."*
- *"Given `deckOpacity` and night emissive are computed and tested but unwired —
  wire them the cheapest way that works, and say what that costs in look."*
