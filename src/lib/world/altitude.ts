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
 *   2. CartoDB road mask   → alpha × (0.3 + 0.7 * mix)  (imagery.ts)
 *   3. Building windows    → density × (1 − mix)        (buildings.ts u_windowDensity)
 * The former Three-side consumers (CityLightField bokeh, NeonLineLayer neon)
 * were retired with the layers themselves.
 *
 * ─── CONTRACT ────────────────────────────────────────────────────────────────
 * Pure + allocation-free. Consumers call altitudeDetailMix(camAltFt) and derive
 * their specific gate from the shared 0..1 result:
 *   NEAR layers (neon, building emissive, CartoDB):  scale by  mix
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
