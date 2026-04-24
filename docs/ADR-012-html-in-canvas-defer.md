# ADR-012 — Defer adopting html-in-canvas until post-Pi-install

**Status:** Proposed
**Date:** 2026-04-24

## Context

The WICG `canvas-draw-element` spec (html-in-canvas.dev) proposes native browser primitives for rendering styled HTML subtrees directly into a canvas — three primitives: `layoutsubtree` attribute, `drawElementImage()` method, and a `paint` event. It's currently behind a feature flag in Chromium 147+ / Brave Stable, under the `canvas-draw-element` flag.

The z-aero-window kiosk is a uniquely good fit on paper:
- We ship our own Chromium on every Pi 5, so feature-flag gating isn't a distribution blocker.
- Our shell UI (window frame, blind, HUD, glass vignette) is stacked above a Cesium WebGL canvas via z-index. A single unified canvas would let post-processing (night grading, bloom, lens distortion) apply across shell + scene uniformly instead of only Cesium's pixels.
- Eleven CSS z-layers currently compose the final frame; a unified canvas collapses that to a draw order.

## Decision

**Defer.** Do not adopt on the path to first Pi install. Track as a post-install option scoped specifically to the night-grading + bloom story.

## Why defer

1. **Adoption cost exceeds current win.** Admin must stay DOM (text inputs, dropdowns, polls — none survive a canvas round-trip). Device-side SidePanel sliders also stay DOM. Realistic conversion target is HUD + WindowFrame + Blind + Glass + Vignette — roughly 60% of shell pixels but 0% of interactive surface. Dual-render-path codebase for a narrow visual win.

2. **Spec stability risk.** `canvas-draw-element` is Chrome-only and flag-gated. No positive signal yet from Gecko or WebKit implementors. Blast radius of a breaking spec change = the entire shell render path.

3. **Dev ergonomics regress.** DevTools inspector for a canvas region is a downgrade from DOM inspection. HMR for shell CSS would route through `paint` event semantics — likely works, but untested. Over a 3-month dev cycle, iteration cost compounds.

4. **Pi 5 performance is unproven.** Plausibly 1-3 ms/frame improvement from unified GPU flush + reduced texture uploads, but could regress if `paint` event fires on every child mutation (loses CSS compositor's lazy repaint).

5. **Greenfield tech-bet history.** The Threlte + takram atmosphere experiment was reversed in phase 8b (-1,612 lines) after discovering Pi 5 performance issues. Lesson: new primitives earn adoption by surviving contact with shipped hardware, not by elegance.

6. **Orthogonal to current cleanup trajectory.** The content/control split (ADR pending, standards.md Rule 0) is about where data lives. html-in-canvas is about how pixels composite. We can ship the REST+SSE refactor, ship Pi, and retrofit html-in-canvas later without affecting the content architecture.

## Revisit if (all three must hold)

1. Frame-time p95 on Pi 5 is ≥ 22 ms and traced to shell compositor cost (not Cesium's own budget).
2. `canvas-draw-element` ships unflagged in Chromium Stable OR reaches a W3C working draft.
3. A spare Pi spike shows measurable GPU memory reduction with a minimal POC.

## What we lose by deferring

- No unified post-processing grade across HUD + scene for first install.
- Shell transforms (bank tilt, breathing motion) remain CSS-driven rather than shader-driven.
- 11 z-layers remain as the composition mechanism.

## What we gain

- Current DOM+canvas composite is a known-working stack. 168 tests, shipped on feature branch.
- Dev iteration speed preserved through first install.
- Optionality: the spec matures while we focus on Pi deployment.

## Related

- `docs/standards.md` Rule 0 — content vs control split (orthogonal, ships independently).
- Phase 8 CSS3D cloud technique (chosen over Bruneton-scattering for similar "earn adoption through hardware" rationale).
