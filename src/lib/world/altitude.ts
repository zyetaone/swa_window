/**
 * world/altitude — the single source of truth for how camera
 * altitude gates the night-light detail layers.
 *
 * ─── WHY THIS LIVES HERE ────────────────────────────────────────────────────
 * Same cross-boundary pattern as world/curves.ts: both Cesium
 * (world/compose.ts) and Three (world-three/NeonLineLayer) need altitude-
 * based fading. Framework-free — no `three`, no `cesium`, pure math.
 *
 * ─── THE FIVE GATES (all former callers) ────────────────────────────────────
 * Each consumer used to hard-code its own LO/HI pair. Migration is staged —
 * the Three-side layers adopt the SSOT now; the Cesium-side gates flip after
 * the Pi-perf gate (they carry TODOs in compose.ts so the diff stays small):
 *   1. VIIRS Cesium layer  (5k → 15k, FAR)   → pending: (1 − mix)        [TODO]
 *   2. CartoDB road mask   (15k → 35k, NEAR) → pending: 0.4 + 0.6 * mix  [TODO]
 *   3. Building emissive    (25k → 55k, NEAR) → pending: 1 − altBlend     [TODO]
 *   4. CityLightField bokeh (FAR)            → LIVE: 0.15 + 0.85 * (1 − mix)
 *   5. NeonLineLayer neon  (NEAR)            → LIVE: mix
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
