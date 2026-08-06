/**
 * cloud-sprite-placement — the shared per-sprite geometry used by BOTH cloud
 * renderers (the Cesium billboard layer and the Three overlay).
 *
 * ─── WHY THIS IS SHARED ─────────────────────────────────────────────────────
 * The same offsets lived in three places: the Cesium billboard layer twice
 * (once per distance band) and the Three cluster builder. They are not
 * incidentally similar — they must be IDENTICAL:
 *
 *  1. Both renderers can drive the sky (`useCesiumClouds` vs `useThreeOverlay`).
 *     Drift between them moves the clouds when the flag flips.
 *  2. Every offset is drawn from a `daySeed()`-seeded RNG so all three Pis in a
 *     panorama build the same deck (invariant #4).
 *
 * ─── ⚠ THE DRAW ORDER IS PART OF THE CONTRACT ───────────────────────────────
 * The callers interleave DIFFERENT draws between position and scale:
 *
 *     Cesium: ox, oz, oy → brightness, opacity → sprScale → texture
 *     Three : ox, oz, oy → sprite index        → sprScale
 *
 * so this module deliberately exposes position and scale as SEPARATE calls
 * rather than one convenient `placeSprite()` returning both. A combined helper
 * would have to consume the scale draw immediately after the position draws,
 * shifting every later value in the seeded stream — which silently changes the
 * rendered sky and de-syncs the 3-Pi seam. Verified numerically before this was
 * written: merging them hands the Cesium path the brightness draw as its scale.
 *
 * Keep the constants and the maths here; keep the ORDER at the call site.
 */

/**
 * Within-cluster X/Z spread, as a multiple of the cluster's base scale.
 * 1.85 was pulled back from an over-aggressive 2.20 (double overdraw, no
 * proportional gain) and is still much wider than the original 1.40.
 */
export const SPRITE_SPREAD_XZ = 1.85;

/** Vertical spread — ~10× tighter than X/Z, because a cloud deck is a SLAB. */
export const SPRITE_SPREAD_Y = 0.18;

/** Anchor scale. Pulled from 1.35 — less individual dominance, softer mass. */
export const ANCHOR_SCALE = 1.25;

/** Non-anchor scale range: [0.95, 1.45] × base. */
export const SPRITE_SCALE_MIN = 0.95;
export const SPRITE_SCALE_SPAN = 0.5;

/** Cluster-local position of one sprite, in metres. */
export interface SpriteOffset {
	ox: number;
	oy: number;
	oz: number;
}

/**
 * Position sprite `i` of a cluster centred at (cx, ch, cz).
 *
 * Sprite 0 is the ANCHOR and sits exactly at the centre, so every cluster has a
 * guaranteed bright core and the rest accumulate outward from it.
 *
 * Draws THREE values from `rng` (x, z, y) — and only for non-anchors.
 */
export function spriteOffset(
	i: number,
	cx: number,
	ch: number,
	cz: number,
	baseScale: number,
	rng: () => number,
): SpriteOffset {
	if (i === 0) return { ox: cx, oy: ch, oz: cz };
	return {
		ox: cx + (rng() - 0.5) * baseScale * SPRITE_SPREAD_XZ,
		oz: cz + (rng() - 0.5) * baseScale * SPRITE_SPREAD_XZ,
		oy: ch + (rng() - 0.5) * baseScale * SPRITE_SPREAD_Y,
	};
}

/**
 * Scale multiplier for sprite `i`. Draws ONE value from `rng`, and only for
 * non-anchors. Call this at the point in the sequence where the caller
 * previously computed `sprScale` — see the draw-order note above.
 */
export function spriteScale(i: number, baseScale: number, rng: () => number): number {
	return baseScale * (i === 0 ? ANCHOR_SCALE : SPRITE_SCALE_MIN + rng() * SPRITE_SCALE_SPAN);
}

/** Metres per degree of latitude. Constant everywhere on the ellipsoid. */
const M_PER_DEG_LAT = 111_320;

/** Local east/north offset in metres, as a geographic delta. */
export interface GeoDelta {
	lat: number;
	lon: number;
}

/**
 * Convert a local east/north offset (metres) at a given latitude into a
 * geographic delta (degrees).
 *
 * ─── ⚠ THE cos(lat) BELONGS ON LONGITUDE ────────────────────────────────────
 * One degree of LATITUDE is ~111.32 km at every latitude — meridians converge
 * at the poles but do not shorten along their own length. One degree of
 * LONGITUDE shrinks as cos(lat), because the parallels are small circles whose
 * radius falls off toward the poles.
 *
 * The Cesium billboard layer previously inlined this twice (once per distance
 * band) with the cos applied to the LATITUDE term instead, which squashes the
 * deck east-west and stretches it north-south by the same factor. The error is
 * zero at the equator and grows with |lat|: at Chicago (41.8°) a sprite meant
 * to sit 20 km east/north landed 5.1 km short and 6.8 km long respectively.
 *
 * Both cloud renderers must agree on sprite placement (see the header note), and
 * the Three overlay derives its positions from a true ENU basis — so the Cesium
 * path had to be corrected to match rather than the other way round.
 */
export function metresToGeoDelta(eastM: number, northM: number, latDeg: number): GeoDelta {
	const cosLat = Math.cos((latDeg * Math.PI) / 180);
	return {
		lat: northM / M_PER_DEG_LAT,
		// Guard the poles: cos(lat) → 0 makes the longitude delta diverge.
		lon: eastM / (M_PER_DEG_LAT * Math.max(cosLat, 1e-6)),
	};
}
