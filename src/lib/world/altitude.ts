/**
 * world/altitude — the single source of truth for how camera
 * altitude gates the night-light detail layers.
 *
 * ─── WHY THIS LIVES HERE ────────────────────────────────────────────────────
 * Same cross-boundary pattern as world/curves.ts: the Cesium side
 * (world/imagery.ts, world/buildings.ts) needs altitude-based fading.
 * Framework-free — no `three`, no `cesium`, pure math.
 *
 * ─── THE GATES ──────────────────────────────────────────────────────────────
 *   1. VIIRS Cesium layer  → alpha × (1 − mix)          (imagery.ts)
 *   2. Road light grid     → alpha × (0.6 + 0.4 * mix)  (imagery.ts roadMaskAlpha,
 *                                                        drawn by roads-geojson)
 *   3. Building windows    → density × (1 − mix)        (buildings.ts u_windowDensity)
 * The former Three-side consumers (CityLightField bokeh, NeonLineLayer neon)
 * were retired with the layers themselves.
 *
 * ─── CONTRACT ────────────────────────────────────────────────────────────────
 * Pure + allocation-free. Consumers call altitudeDetailMix(camAltFt) and derive
 * their specific gate from the shared 0..1 result:
 *   NEAR layers (neon, building emissive, road grid): scale by  mix
 *   FAR  layers (VIIRS aggregate):                   scale by (1 − mix)
 */

/** Below this altitude all near-detail layers are at full intensity. */
export const DETAIL_ALT_LO_FT = 5_000;   // approach/landing band

/** Above this altitude near-detail layers are fully absent; FAR (VIIRS) dominates. */
export const DETAIL_ALT_HI_FT = 35_000;  // cruise FL350

/**
 * Canonical altitude-detail mix.
 *
 * @returns 1 at low altitude (≤DETAIL_ALT_LO_FT) — full near detail;
 *          0 at cruise (≥DETAIL_ALT_HI_FT)        — no near detail, VIIRS dominant.
 *
 * Near layers multiply their opacity by this value.
 * Far  layers multiply their opacity by (1 − this value).
 */
export function altitudeDetailMix(camAltFt: number): number {
	return Math.max(
		0,
		Math.min(
			1,
			1 - (camAltFt - DETAIL_ALT_LO_FT) / (DETAIL_ALT_HI_FT - DETAIL_ALT_LO_FT),
		),
	);
}

/**
 * Upper bound of the operator's "Night Lights" knob
 * (`config.world.nightLightIntensity`, surfaced by LightingControls).
 *
 * SSOT because the number is needed in three places that must agree: the
 * slider's `max`, the shader gain, and the VIIRS layer alpha — which has to
 * NORMALISE against it, since an alpha cannot use a 0..5 gain raw. When the
 * slider max and the alpha's assumed max drift apart, part of the control
 * silently stops doing anything.
 */
export const NIGHT_LIGHT_SCALE_MAX = 5.0;

/**
 * The 0..5 Night Lights knob, normalised to a 0..1 multiplier.
 *
 * ─── ⚠ EVERY UNIT-RANGE CONSUMER MUST GO THROUGH THIS ───────────────────────
 * The knob is a GAIN, not a multiplier. Applied raw to anything authored for
 * ~1 it saturates instantly, which both blows out the look AND silently kills
 * whatever else was multiplying in — the term pins at its ceiling and stops
 * responding. That has now shipped FOUR separate times:
 *
 *   viirsLayerAlpha   pinned opaque; altitude gate dead across the show band
 *   roadMaskAlpha     evaluated to 3.664, assigned with no clamp at all
 *   u_lightIntensity  +(0.90,0.45,0.10) orange wash over half the ground
 *   viirsAlphaBoost   product > 1 froze the altitude gate flat
 *
 * Three of those carried comments warning about the trap, and a fourth still
 * shipped — so the fix is one shared function, not more prose.
 *
 * NOT the only valid treatment: buildings.ts deliberately passes the gain RAW
 * and Reinhard tone-maps it in-shader (see NIGHT_EMISSIVE_WHITE_POINT), which
 * keeps the knob expressive across its whole travel instead of costing 5x
 * brightness. Normalise for unit-range terms; tone-map for HDR ones. What is
 * never correct is feeding it raw into something that clips.
 */
export function nightLightGain(scale: number): number {
	const g = scale / NIGHT_LIGHT_SCALE_MAX;
	return g < 0 ? 0 : g > 1 ? 1 : g;
}

/**
 * Raw emissive channel value that tone-maps to pure white in the building
 * shader's Reinhard curve:  x * (1 + x/W²) / (1 + x).
 *
 * ─── ⚠ W MUST BE >= THE PEAK RAW VALUE, OR THE CURVE STOPS TONE-MAPPING ─────
 * By construction x = W maps to exactly 1.0, so ANY raw value above W leaves
 * the 0..1 range and clips. Cesium's material.emissive is LDR, so clipping is
 * pure white.
 *
 * This was 2.2 while the window palette peaks at 7.0 raw (gain 5.0) and the
 * DIMMEST window sits at 2.79 — so every window in the city, dim ones
 * included, exceeded W and clamped to white:
 *
 *              raw    extended W=2.2    simple x/(1+x)
 *   dimmest   2.79        1.160             0.736
 *   peak      7.00        2.140             0.875
 *
 * i.e. precisely the "identical white boxes" failure the tone-map exists to
 * prevent. Note the right-hand column: the 0.88 / 0.74 figures quoted in
 * buildings.ts are simple Reinhard with NO white point. Those were computed
 * correctly, then a white point was introduced that inverted the result — the
 * comment described one curve while the code shipped another.
 *
 * 7.0 is the peak raw value, so peak maps to exactly 1.0 (genuinely white)
 * while the dimmest lands at 0.778 — a 0.22 spread that keeps the amber/gold
 * palette separable. Raising the gain above 5.0 pushes peak past W again;
 * that is the operator's business, and it degrades gracefully into clipping
 * rather than the palette collapsing at the DEFAULT setting.
 */
export const NIGHT_EMISSIVE_WHITE_POINT = 7.0;
