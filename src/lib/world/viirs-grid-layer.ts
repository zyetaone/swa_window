/**
 * VIIRS grid imagery layer — procedural city-block texture rendered into
 * a canvas, mapped onto a Cesium Rectangle entity around the current
 * location.
 *
 * Reframe context (2026-05-22): replaces the prior CSS-DOM
 * ViirsGridEffect, which was screen-anchored and didn't parallax with
 * the camera, ignored depth/occlusion, and read as "tint on the glass"
 * rather than "city blocks on the ground." This is the same intensity
 * field, painted into a canvas that lives IN THE MAP — world-anchored,
 * occluded by terrain, lit by Cesium's scene, parallax-correct on bank.
 *
 * Implementation chose Entity + RectangleGraphics + ImageMaterialProperty
 * over SingleTileImageryProvider.fromUrl because:
 *   - synchronous (no blob URL round-trip, no Promise races on hot reload)
 *   - the canvas IS the texture — repainting updates Cesium automatically
 *   - rectangle classifies onto terrain naturally, occlusion just works
 *
 * Cost: one canvas paint per location change (~3 ms for 1024×1024 at
 * 64×64 cells). Cesium owns the GPU texture; no DOM compositing.
 */

import type * as CesiumType from 'cesium';

const CANVAS_SIZE = 2048;             // higher res so blocks read crisp from cruise altitude
const GRID = 48;                       // cells per axis — fewer + bigger = discrete blocks read better at distance
const RECT_RADIUS_DEG = 1.5;           // half-extent of the rectangle in degrees
const BLOCK_WIDTH_FRACTION = 0.35;     // narrow stripes — leave gaps between buildings
const COLOR_HDR_GAIN = 1.6;            // canvas paints bright cells; ACES tonemap maps overshoot to glow

/**
 * Paint the city-block intensity field into the given canvas. Deterministic
 * by (lat, lon) so the same place gives the same pattern across reloads;
 * heavy-tailed power curve so a few cells bloom bright while most stay dim.
 *
 * Multiplied by `density` (location.scene.nightLightDensity) so oceans paint
 * nothing and Hyderabad paints a full grid.
 */
function paintGrid(canvas: HTMLCanvasElement, lat: number, lon: number, density: number): void {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
	if (density < 0.02) return;

	// Additive blend INSIDE the canvas — overlapping blocks brighten each
	// other (rare with our grid, but the more important effect is that
	// transparent background stays transparent: only painted cells contribute
	// to the texture, so Cesium's alpha blend treats unlit cells as
	// fully-skip rather than as dim-tint.
	ctx.globalCompositeOperation = 'lighter';

	const cellW = CANVAS_SIZE / GRID;
	const cellH = CANVAS_SIZE / GRID;

	for (let cy = 0; cy < GRID; cy++) {
		for (let cx = 0; cx < GRID; cx++) {
			// Deterministic hash seeded by cell + location.
			const seed = Math.sin(
				cx * 12.9898
				+ cy * 78.233
				+ lat * 0.873
				+ lon * 0.531,
			) * 43758.5453;
			const r = seed - Math.floor(seed);
			const intensity = Math.pow(r, 2.2) * density;
			if (intensity < 0.15) continue;   // raised threshold — fewer, more deliberate cells

			// 3-stop warm palette — sodium → amber → warm-white. Mirrors the
			// shader so the procedural tiles + shader palette + VIIRS raster
			// all read as the same colour family.
			let R: number, G: number, B: number;
			if (intensity > 0.5) {
				const t = Math.min(1, (intensity - 0.5) / 0.4);
				R = 255;
				G = Math.round(204 + (242 - 204) * t);
				B = Math.round(102 + (217 - 102) * t);
			} else {
				const t = Math.max(0, (intensity - 0.15) / 0.35);
				R = 255;
				G = Math.round(153 + (204 - 153) * t);
				B = Math.round(51 + (102 - 51) * t);
			}

			// Full alpha — additive composite means alpha is the contribution
			// strength, and we want lit cells fully present. Intensity drives
			// COLOR brightness rather than alpha.
			const x = cx * cellW;
			const y = cy * cellH;
			const w = cellW * BLOCK_WIDTH_FRACTION;
			const h = cellH * (0.25 + intensity * 0.85);

			ctx.fillStyle = `rgba(${R}, ${G}, ${B}, 1)`;
			ctx.fillRect(x, y, w, h);
		}
	}

	// Restore default composite for next paint cycle.
	ctx.globalCompositeOperation = 'source-over';
}

export class ViirsGridLayer {
	private canvas: HTMLCanvasElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private entity: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private dataSource: any = null;
	private lastKey = '';

	constructor(
		private C: typeof CesiumType,
		private viewer: CesiumType.Viewer,
	) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = CANVAS_SIZE;
		this.canvas.height = CANVAS_SIZE;
	}

	/**
	 * Update (or hide) the imagery based on current state. Throttled via a
	 * coarse cache key so per-frame calls are essentially free unless
	 * something material changed.
	 *
	 * @param lat     current view latitude
	 * @param lon     current view longitude
	 * @param density location.scene.nightLightDensity (0..1)
	 * @param alpha   final alpha (already gated by nightFactor)
	 */
	update(lat: number, lon: number, density: number, alpha: number): void {
		if (alpha < 0.005 || density < 0.02) {
			if (this.entity) this.entity.show = false;
			this.lastKey = '';
			return;
		}

		// Coarse cache key — re-render only when one of these crosses a step.
		// Lat/lon rounded to 0.5° (~55 km bucket).
		const key = `${Math.round(lat * 2)}|${Math.round(lon * 2)}|${density.toFixed(2)}`;
		const repaint = key !== this.lastKey;
		this.lastKey = key;

		if (repaint) {
			paintGrid(this.canvas, lat, lon, density);
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.C as any;

		// HDR color multiplier — push the brightness above 1.0 so painted
		// cells overshoot into HDR, which the ACES tonemap in compose.ts maps
		// to glow rather than clipping. Without this, full-bright canvas
		// cells (255 amber) render at the same brightness as the underlying
		// terrain at 255 — no perceptual additive effect.
		const colorR = COLOR_HDR_GAIN;
		const colorG = COLOR_HDR_GAIN;
		const colorB = COLOR_HDR_GAIN;

		if (!this.entity) {
			// First mount — create the dataSource + entity once. Subsequent
			// updates just move the rectangle, swap material (cheap), or
			// toggle show.
			//
			// Why NOT classificationType: TERRAIN — Cesium classification
			// only supports a small set of material types (Color, mostly).
			// ImageMaterialProperty isn't on the list and throws RuntimeError
			// at construction. We accept that the rectangle sits at ground
			// altitude (0) instead of draping onto terrain bumps.
			this.dataSource = new C.CustomDataSource('viirs-grid');
			this.viewer.dataSources.add(this.dataSource);
			this.entity = this.dataSource.entities.add({
				rectangle: {
					coordinates: C.Rectangle.fromDegrees(
						lon - RECT_RADIUS_DEG,
						lat - RECT_RADIUS_DEG,
						lon + RECT_RADIUS_DEG,
						lat + RECT_RADIUS_DEG,
					),
					material: new C.ImageMaterialProperty({
						image: this.canvas,
						transparent: true,
						color: new C.Color(colorR, colorG, colorB, alpha),
					}),
					height: 0,
				},
			});
		} else {
			this.entity.show = true;
			// Move the rectangle if location moved.
			if (repaint) {
				this.entity.rectangle.coordinates = C.Rectangle.fromDegrees(
					lon - RECT_RADIUS_DEG,
					lat - RECT_RADIUS_DEG,
					lon + RECT_RADIUS_DEG,
					lat + RECT_RADIUS_DEG,
				);
			}
			this.entity.rectangle.material = new C.ImageMaterialProperty({
				image: this.canvas,
				transparent: true,
				color: new C.Color(colorR, colorG, colorB, alpha),
			});
		}
	}

	destroy(): void {
		if (this.dataSource) {
			this.viewer.dataSources.remove(this.dataSource, true);
			this.dataSource = null;
			this.entity = null;
		}
	}
}
