/**
 * Pure math for the VIIRS × roads composite — no Bun/sharp/fs deps, so it is
 * directly unit-testable from tests/tools/.
 *
 * Both layers live on the same WebMercator XYZ pyramid, which makes the
 * resample exact integer geometry:
 *
 *   - road tile (z, x, y) is ROAD_PX × ROAD_PX pixels (CartoDB @2x → 512)
 *   - VIIRS tile (VIIRS_Z, vx, vy) is VIIRS_PX × VIIRS_PX pixels (GIBS → 256)
 *   - the road tile's footprint in VIIRS-zoom pixel space is a rect of
 *     2^(VIIRS_Z − z) · VIIRS_PX · (ROAD_PX / 256... ) — see viirsCoverForRoadTile
 *
 * viirsCoverForRoadTile() returns the set of VIIRS tiles intersecting that
 * footprint, each with:
 *   extract — rect to cut out of the VIIRS tile (VIIRS-tile-local pixels)
 *   dest    — rect that extract occupies on the road tile's pixel grid
 */

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface ViirsPiece {
	/** VIIRS tile coords at VIIRS_Z. */
	vx: number;
	vy: number;
	/** Region to extract from the VIIRS tile (its local pixel space). */
	extract: Rect;
	/** Where that region lands on the road tile's pixel grid. */
	dest: Rect;
}

/** GIBS night layers cap at z8 — the finest VIIRS zoom the packager caches. */
export const VIIRS_Z = 8;
/** GIBS GoogleMapsCompatible tiles are 256 px. */
export const VIIRS_PX = 256;
/** CartoDB @2x tiles are 512 px. */
export const ROAD_PX = 512;

/**
 * VIIRS tiles covering road tile (z, x, y), with exact extract/dest rects.
 *
 * Derivation: in VIIRS-zoom pixel space the world is VIIRS_PX·2^VIIRS_Z px
 * wide; the road tile spans ROAD_PX·2^z px of its own grid, so one road pixel
 * is s = VIIRS_PX·2^VIIRS_Z / (ROAD_PX·2^z) VIIRS pixels. With the stock
 * constants s = 2^(7−z): integer for z ≤ 7, a power-of-two fraction above,
 * so every rect below stays an exact integer at every zoom.
 *
 * Tiles outside the VIIRS zoom range (z < VIIRS_Z) fan out over many VIIRS
 * tiles; tiles deeper than VIIRS_Z sample a sub-rect of exactly one (XYZ
 * pyramids nest perfectly — a deeper tile never straddles a parent edge).
 */
export function viirsCoverForRoadTile(
	z: number,
	x: number,
	y: number,
	roadPx: number = ROAD_PX,
	viirsZ: number = VIIRS_Z,
	viirsPx: number = VIIRS_PX,
): ViirsPiece[] {
	// Road-tile footprint in VIIRS-zoom pixel space.
	const scale = (viirsPx * 2 ** viirsZ) / (roadPx * 2 ** z); // VIIRS px per road px
	const fpLeft = x * roadPx * scale;
	const fpTop = y * roadPx * scale;
	const fpRight = fpLeft + roadPx * scale;
	const fpBottom = fpTop + roadPx * scale;

	const vxMin = Math.floor(fpLeft / viirsPx);
	const vxMax = Math.floor((fpRight - 1e-9) / viirsPx);
	const vyMin = Math.floor(fpTop / viirsPx);
	const vyMax = Math.floor((fpBottom - 1e-9) / viirsPx);
	const n = 2 ** viirsZ;

	const pieces: ViirsPiece[] = [];
	for (let vy = vyMin; vy <= vyMax; vy++) {
		for (let vx = vxMin; vx <= vxMax; vx++) {
			// No wraparound: road tiles near the antimeridian simply have no
			// VIIRS cover past the edge (treated as unlit background).
			if (vx < 0 || vy < 0 || vx >= n || vy >= n) continue;

			// Intersection of footprint with this VIIRS tile, in VIIRS px.
			const ix0 = Math.max(fpLeft, vx * viirsPx);
			const iy0 = Math.max(fpTop, vy * viirsPx);
			const ix1 = Math.min(fpRight, (vx + 1) * viirsPx);
			const iy1 = Math.min(fpBottom, (vy + 1) * viirsPx);

			pieces.push({
				vx,
				vy,
				extract: {
					left: Math.round(ix0 - vx * viirsPx),
					top: Math.round(iy0 - vy * viirsPx),
					width: Math.round(ix1 - ix0),
					height: Math.round(iy1 - iy0),
				},
				dest: {
					left: Math.round((ix0 - fpLeft) / scale),
					top: Math.round((iy0 - fpTop) / scale),
					width: Math.round((ix1 - ix0) / scale),
					height: Math.round((iy1 - iy0) / scale),
				},
			});
		}
	}
	return pieces;
}

/**
 * Rec.601 luma. The cached VIIRS tiles were downloaded with saturation 0, so
 * in practice r ≈ g ≈ b — this stays correct even if that ever changes.
 */
export function luma601(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Road-glow multiplier for a VIIRS luminance sample (0–255).
 *
 * Linear remap lum ∈ [0,255] → factor ∈ [floor, 1]. Chosen over a hard
 * max(floor, lum/255) knee because it preserves VIIRS' intra-city gradient
 * across the whole range — downtown cores still out-bloom the suburbs — while
 * the floor guarantees sparse-but-real towns (and cache-edge tiles whose
 * VIIRS cover is missing) keep a minimum of road structure instead of going
 * fully dark.
 */
export function glowFactor(luminance: number, floor: number): number {
	const lum = Math.min(255, Math.max(0, luminance)) / 255;
	return floor + (1 - floor) * lum;
}

/**
 * In-place multiply of an RGBA road-tile raw buffer by the per-pixel glow
 * factor derived from a same-size RGB VIIRS raw buffer. Alpha untouched —
 * the app keys transparency off black via colorToAlpha, not the alpha channel.
 */
export function modulateRoadPixels(
	roadRaw: Uint8Array,
	viirsRaw: Uint8Array,
	pixelCount: number,
	floor: number,
): void {
	for (let i = 0; i < pixelCount; i++) {
		const r = viirsRaw[i * 3];
		const g = viirsRaw[i * 3 + 1];
		const b = viirsRaw[i * 3 + 2];
		const f = glowFactor(luma601(r, g, b), floor);
		roadRaw[i * 4] = Math.round(roadRaw[i * 4] * f);
		roadRaw[i * 4 + 1] = Math.round(roadRaw[i * 4 + 1] * f);
		roadRaw[i * 4 + 2] = Math.round(roadRaw[i * 4 + 2] * f);
	}
}
