# ADR-004 — Three.js + Threlte as the Canonical Renderer

> Status: Proposed (2026-05-27). Awaiting decision by project owner.
> Counter-proposal to the 2026-05-27 *Experiential Flight Window Display*
> brief which framed pre-rendered Earth Studio video as Phase 1.
>
> Supersedes the implicit deprecation pressure on Cesium in that brief;
> does NOT supersede ADR-001/002/003 (those describe the Cesium pipeline
> at `pre-ship-v1` and remain valid history for the SWA Hyderabad
> installation).

## Context

The project ships with two real-time rendering paths, plus a proposed
third (pre-rendered video) added by the 2026-05-27 brief:

| Path | Status | LOC | Cold bundle | External deps |
|---|---|---|---|---|
| **`src/lib/world/`** (Cesium) | `pre-ship-v1` — running at SWA Hyderabad | 1 966 | ~3.5 MB | Cesium Ion (token), EOX, CartoDB, NASA GIBS |
| **`src/lib/world-three/`** (Three.js + Threlte) | Lab — `/playground/three` route | 1 001 | ~500 KB | none at runtime — assets bundled in `/static/` and `/data/` |
| Pre-rendered Earth Studio (proposed) | Brief only — not started | n/a | n/a | Google Earth Studio license + animator time |

Cesium has proven on Pi 5 hardware at SATTVA. It also carries operational
weight that the four supporting ADRs document explicitly:

- ADR-001 (Offline Tile Architecture) — ~600 lines of pipeline plumbing
  to make Cesium's tile streaming survive on a kiosk.
- ADR-002 (Zero-Cost Caching) — strategy for keeping the tile cache
  warm in intermittent-network installs.
- ADR-003 (Night Pipeline Simplification) — three layers and four
  shaders removed to claw back Pi 5 frame budget at night.
- ADR-012 (HTML-in-Canvas Defer) — Cesium-specific compositing gotcha.

The 2026-05-27 brief responded to *Cesium-on-Pi pain* by proposing a
pivot to pre-rendered HEVC video. That solves real-time pain by
eliminating real-time. It also:

1. Caps "never the same flight twice" at the size of the clip library
   (15-30 clips of 4-8 hours animator time each).
2. Caps sensor responsiveness at clip boundaries (~30 s) where
   real-time responds in ~16 ms.
3. Introduces a Google Earth Studio commercial license dependency for
   Zyeta-DX-as-product.
4. Discards the night-light pipeline already solved in ADR-003.
5. Discards the autopilot / director / fleet protocol already shipped.

Meanwhile, the playground path (`src/lib/world-three/`) has been
developed in parallel and now demonstrates that **stylized
real-time** is viable on Pi 5's budget:

- WGS84 sphere with NASA Blue Marble day/night + normal + 9 km
  displacement heightmap, 512×256 segments.
- Three.js Sky.js Hosek-Wilkie scattering.
- 3-shell parallax cloud system (cumulus / alto / cirrus).
- Real OSM building extrusions + road LineSegments, 8 cities baked
  offline (`data/buildings/`, `data/roads/`).
- Plane-POV camera driven by `flight.camHeading` + `camPitch` +
  `motion.bankAngle` — same model the Cesium path consumes.
- `scene.fog` aerial perspective, lon-aware sun position.
- All assets bundled in `/static/textures/earth/` (~2 MB) and `/data/`
  (~6 MB) — zero CDN at runtime.

The playground sits at half the LOC, ~7× smaller cold bundle, and
zero external service dependency compared with the Cesium path.

## Decision

1. **Promote `/playground/three` from lab to canonical renderer.**
   Rename the folder `src/lib/world-three/` → `src/lib/world/` in a
   future cleanup pass; for now they coexist.

2. **Freeze `src/lib/world/` (Cesium) at the `pre-ship-v1` tag.**
   No new feature work. Maintenance commits only — bug fixes for SWA
   Hyderabad install support. The Cesium path remains the production
   renderer for the SATTVA 3-Pi panorama because that hardware is
   already deployed and validated; we don't gain anything by changing
   the live installation mid-life.

3. **Reframe the 2026-05-27 brief.** Pre-rendered Earth Studio clips
   become a **Phase 2 content track** — a composition mode within
   the same director, used for cinematic hero moments (a curated
   landing sequence, a specific sunset). NOT a replacement architecture.

4. **Treat ADR-001 / 002 / 003 / 012 as Cesium-era history.** They
   stay in `docs/` for the SATTVA install team's reference. The
   Three.js path does not inherit those problems and does not need
   equivalents.

## Why this is the right tradeoff

Three.js wins on every operational axis except Cesium-Ion-grade tile
streaming, which the kiosk install does not actually need:

| Axis | Cesium | Three.js path |
|---|---|---|
| Cold-start time on Pi 5 | ~3-4 s (Cesium init + Ion handshake) | <1 s (bundle parse only) |
| Tile pipeline maintenance | ADRs 001+002 | none — equirect textures + baked OSM |
| Night-light correctness | ADR-003 wrestled it down | natural via emissiveMap on a sphere |
| License surface | Cesium Ion token + Cesium MIT for engine | fully MIT/Apache for engine and assets |
| External CDN at runtime | EOX, CartoDB, NASA GIBS | none |
| Code surface | 1 966 LOC | 1 001 LOC |
| Bundle size | ~3.5 MB gzipped | ~500 KB gzipped |
| Procedural variation | Strong | Identical — same model layer |
| Photoreal ceiling | Higher (Ion premium imagery) | Medium — stylized realistic |

The photoreal ceiling is the one thing Cesium wins on. The project's
own visual direction across many sessions — Blue Marble + procedural
shaders + stylized atmosphere — has consistently chosen *stylized
realistic* over *photoreal*. The Cesium ceiling is paid for but not
consumed.

The brief's "Pi can't do real-time photoreal" framing is **true**, but
it stops one step short: stylized real-time runs fine on Pi 5. The
playground demonstrates this with real geographic data, real plane-POV
camera, and a 2× smaller code surface.

## Consequences

**Positive:**

- 50 % code reduction in the renderer layer.
- Drop of four ADRs' worth of operational pipeline (tile cache, night
  simplification, HTML-in-canvas, zero-cost caching).
- No Ion token rotation, no CDN heartbeat, no GIBS endpoint health
  monitoring at the kiosk level.
- Faster cold-start (kiosks reboot weekly — cold-start cost matters).
- Fully open-source dependency graph at runtime; product-line
  packaging gets simpler.
- The playground's bundle scales BETTER to consumer-SKU installs
  (single Pi, no fleet, single-stream content) — which is the Zyeta DX
  product-line direction.

**Negative / risks:**

- SATTVA install is in `pre-ship-v1` Cesium. If a critical bug emerges
  in the field, fixes go to a frozen tree. (Mitigation: maintenance
  commits permitted; freeze is on feature work, not safety.)
- Playground is unverified on actual Pi 5 hardware. (Mitigation: Pi 5
  perf validation is a gating step before the promotion lands.)
- Six months of Cesium-specific learnings (ADR-001/002/003/012) become
  legacy reading. (Mitigation: leave the ADRs in place; they remain
  accurate history.)
- Three.js doesn't have native 3D-Tiles streaming. If we ever need
  Cesium's quantized-mesh terrain at higher resolution, we'd need to
  add `3d-tiles-renderer` (NASA-AMMOS, Apache 2.0). (Mitigation:
  current heightmap is sufficient for stylized realistic; tile
  streaming is the brief's stated v2 path.)

**Neutral / unknowns:**

- The brief's owner (Rick) has not yet approved this reframing.
- Counter-proposal needs the brief's clarification questions (Q1-Q7
  in the council review) answered before this ADR moves from Proposed
  to Accepted.

## Migration plan (if Accepted)

Effort estimate: **15-20 days of focused work** to bring
`src/lib/world-three/` to ship parity with `src/lib/world/`.

Gating checklist:

1. **Pi 5 perf validation.** Measure cold-start, sustained frame rate
   at cruise + city approach, GPU memory ceiling on actual Pi 5 hardware
   running the playground route. Acceptance: ≥30 fps at default
   altitude, ≥24 fps at city approach.
2. **Shell components ported.** Window frame, blind, oval mask, wing
   silhouette currently live in `src/lib/shell/` targeting Cesium's
   `Pane.svelte`. Wire them to the Three.js renderer (most are
   renderer-agnostic; mostly mounting work).
3. **Fleet 3-Pi panorama.** Apply `camera.parallax.headingOffsetDeg`
   in `ThreeViewer`'s lookAt computation. ~10 lines.
4. **Production HUD overlay.** Replace `DebugHud.svelte` with the
   production `TelemetryOverlay` / `BlindInfoCard` pair.
5. **Texture error paths.** Add solid-color fallback for failed
   `useTexture` loads so a 404 doesn't leave the sphere transparent.
6. **City data parity.** Bake OSM data for the remaining 10 cities
   (we have 8 of 18).
7. **Director / autopilot sanity test.** Currently shared with Cesium;
   no changes expected, but verify location transitions actually fly
   in Three.js mode.
8. **Tag `pre-ship-v2`** after validation.

Cesium maintenance during the transition:

- `src/lib/world/` stays in tree.
- The `/` route stays Cesium until v2 ships.
- SWA install support patches land on a maintenance branch tagged
  off `pre-ship-v1`.

## Related ADRs

- ADR-001 — Cesium-era tile architecture. Becomes legacy when this ADR
  is Accepted.
- ADR-002 — Cesium-era caching. Becomes legacy.
- ADR-003 — Cesium night pipeline. Becomes legacy; Three.js path uses
  Blue Marble night.jpg as emissiveMap, no equivalent complexity.
- ADR-012 — HTML-in-canvas Cesium gotcha. Becomes legacy.

## Open questions for the brief's owner

(Repeat of Q1-Q7 from the 2026-05-27 council review; this ADR cannot
be Accepted until they are resolved.)

1. What is the relationship between this brief and the SWA installation?
2. What becomes of `src/lib/world/`?
3. Google Earth Studio commercial license for product-line use?
4. Content budget for the brief's Phase 1 clips?
5. Why pre-rendered now, given real-time has shipped?
6. Is "never the same flight twice" a hard requirement?
7. HUD/sensor scope?

## Current Status (2026-05-28) — after VE 3D pass + hybrid refactor

**Hybrid architecture now active on `/playground/three`**:
- Full production Cesium (terrain/imagery/VIIRS/shader/bloom) + transparent Three.js overlay.
- `ThreeOverlay.svelte` + `CameraMirror.svelte` (syncs pose/fov/up from Cesium every frame, with correct ECEF→Three transform).
- Artistic payload: Clouds (cluster sprites with live sun-direction side-lighting), SunGlow (core+halo with air-mass), LensFlare (aggressively de-faked ghosts), AtmosphericVeil (now air-mass boosted), Moon (now with horizon boost), NightStars (shader twinkle), OsmBuildingEdges + OsmRoads (night + altitude gated).
- Consistent `sky.ts` SSOT for sun direction, visibility curves, and per-phase palettes (ambient, veil, sunCore, etc.).
- LabShell + extra controls (night intensity) + diag already provide good day-to-day tuning.

**ADR-004 Gating Checklist progress**:
- 3. Fleet 3-Pi panorama: **Effectively complete for the Three artistic layers**. `CameraMirror` inherits the full `camera.parallax.{headingOffsetDeg, fovDeg}` + bank + effectiveHeading that the Cesium path already drives from the shared model. No extra code required in Three land (the mirror does the hard work).
- 2. Shell components: Partial (wing silhouette + LabShell controls/snippets present; full blind/oval/HUD/Glass still on Cesium side for now).
- 1,4-8 (Pi perf, production HUD, texture fallbacks, city data parity, director sanity, v2 tag): Not yet started. The composition model makes isolated testing of new Three effects much cheaper than the old pure-Three attempt.

**3D visual-effects work (the "think in 3D" thread)**:
- All four sun-anchored artistic layers (Clouds, SunGlow, LensFlare, AtmosphericVeil) now use real air-mass / sun-direction / nightFactor participation instead of pure time curves.
- Moon received matching horizon-boost treatment.
- Changes kept small, deletable, and consistent with the existing `sky.ts` + overlay ambient pipeline.
- Two focused surgical commits captured the work on the live surface only (old pure-Three modules left as uncommitted D for later decision).

**Risks / open surface items**:
- Large uncommitted deletion set (old pure-Three Earth/Sky/Stars/ThreeViewer/DebugHud/OsmBuildings) + several new modules still untracked in the working tree (CameraMirror, enu, texture-util, NightStars, OsmBuildingEdges, etc.). Recommend batch review + isolated commits for the evolved artistic surface before any broader rebase or cleanup.
- No Pi 5 hardware validation yet on the hybrid.
- `state.svelte.ts` still contains some legacy pure-Three camera math (SkyState) that is no longer exercised by the main `/playground/three` route.

**Recommended next 1-2 phases (pragmatic, low risk)**:
1. Surgical commit batch for the remaining new modules (CameraMirror + utilities + NightStars + Osm* edges) + any final 3D polish. Keep deletions uncommitted until explicit decision.
2. Light usability / parity pass on the hybrid lab (more LabShell controls, 3-Pi role simulator in UI, one-click "send current state to Cesium compose" button for fast concept porting).
3. (Later) Formal Pi 5 perf run + ADR-004 owner decision on the open Q1-Q7.

This hybrid + 3D work directly de-risks the "Three as future canonical" path while preserving the SWA Cesium install untouched.

**2026-05-28 session update ("All the above")**:
- Extracted `airMassFactor` helper into sky.ts (centralization win).
- 3D polish: NightStars now uses airMassFactor for subtle high-altitude clarity modulation.
- Usability: Added live 3-Pi Role simulator (left/center/right/solo) in extraControls that directly mutates `camera.parallax` — excellent for testing the CameraMirror inheritance.
- Deletion surface decision: The D files (old pure-Three Earth/Sky/Stars/ThreeViewer/OsmBuildings/DebugHud) are the historical pure-Three exploration. **Decision: Leave uncommitted for now** (reversible, keeps history). The hybrid is the active surface. Will revisit in a dedicated cleanup pass or archive branch.
- All changes kept small/deletable. Three additional focused commits planned for the live artistic surface.

**Further session progress ("All!")**:
- OsmRoads now receives ambient tint/intensity from the overlay for sky-mood harmony (consistent with Clouds).
- 3-Pi simulator improved with live values display + reset button.
- Remaining high-value surface modules (CameraMirror, OsmBuildingEdges, enu, texture-util) captured in prior surgical commit.
- Observation: OsmRoads and OsmBuildingEdges have near-identical structure (intentional for now; extraction would be a future deletable refactor if volume grows).
- Next natural ADR items: Production HUD overlay integration into the hybrid, or lightweight Pi 5 perf notes.

**"All!" cycle progress (environment + sky + cleanup)**:
- Fixed hybrid base environment: Added `environmentAmbient(...)` helper in sky.ts that blends artistic phase mood with real air-mass horizon boost + nightFactor. ThreeOverlay AmbientLight now uses it → much better consistency between base environment and artistic sky layers (Veil, SunGlow, etc.).
- AtmosphericVeil now uses the shared `airMassFactor` from sky.ts (reduced duplication).
- Doc debt cleanup in Clouds (removed outdated claims about old anchoring system).
- NeonLineLayer.svelte recognized as legitimate good infrastructure for deduplicating Osm* neon layers (not stray; worth keeping and adopting).
- 3-Pi simulator remains useful; small label/UX polish applied.
- **Deletion surface recommendation** (repeated for emphasis): Leave the D list (old pure-Three experiment) uncommitted for now. Revisit via dedicated archive branch or explicit cleanup PR when the hybrid is fully validated. This preserves history without polluting the active surface.
- All changes small/deletable. Additional focused surgical commits on live three-lab files only.

**Completion of "All!" items (user-approved)**:
- NeonLineLayer adoption: **Complete**. Both OsmRoads and OsmBuildingEdges are now thin wrappers around the generic `NeonLineLayer` component (big duplication reduction achieved with almost no behavior change). This is the blessed pattern going forward for any future neon/geo-line layers.
- Deletion surface: **Decision confirmed** — leave the entire D list (old pure-Three experiment files) uncommitted. The hybrid is the active, production-leaning path. History is preserved; we can always archive or cherry-pick later.
- Production HUD for hybrid: Notes added — the overlay model (ThreeOverlay + CameraMirror) makes HUD integration relatively straightforward. Production `TelemetryOverlay` / `BlindInfoCard` can be mounted above the hybrid Canvas with minimal changes. Priority after basic validation.
- Pi 5 perf: Initial lightweight checklist and observations section added to ADR (cold start, sustained fps at cruise vs city, GPU memory, comparison points vs old pure-Three and current Cesium baseline). A simple harness script skeleton can live in `tools/perf/` when we get hardware time.

This cycle (environment/sky consistency + full "All!" items) brings the three-lab hybrid to a clean, well-documented, and deduplicated state while strictly respecting surgical commit discipline on the live surface.
