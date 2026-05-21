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
const GRID = 96;                       // cells per axis — perceptual block density
const RECT_RADIUS_DEG = 1.2;           // half-extent of the rectangle in degrees (smaller = blocks read smaller)
const BLOCK_WIDTH_FRACTION = 0.4;      // narrow stripes — leave gaps between buildings

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
			if (intensity < 0.1) continue;

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

			const alpha = Math.min(1, intensity * 1.2);
			const x = cx * cellW;
			const y = cy * cellH;
			const w = cellW * BLOCK_WIDTH_FRACTION;
			// Y-dynamic block height — intensity drives how tall the stripe is.
			const h = cellH * (0.25 + intensity * 0.85);

			// Sharp blocks, no canvas shadow blur — at cruise altitude any
			// shadow smudges the grid into a wash. The shader's bloom pass
			// will halo bright pixels in post.
			ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha.toFixed(2)})`;
			ctx.fillRect(x, y, w, h);
		}
	}
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

		if (!this.entity) {
			// First mount — create the dataSource + entity once. Subsequent
			// updates just move the rectangle and toggle show/alpha.
			//
			// Why NOT classificationType: TERRAIN — Cesium classification
			// only supports a small set of material types (Color, mostly).
			// ImageMaterialProperty isn't on the list and throws RuntimeError
			// at construction. We accept that the rectangle sits at ground
			// altitude (0) instead of draping onto terrain bumps; the lat/lon
			// footprint is what matters for the look anyway.
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
						// Per-image alpha multiplier — saturates with the
						// canvas's own alpha values, so the warm cells'
						// per-pixel alpha is preserved.
						color: new C.Color(1, 1, 1, alpha),
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
			// Always update alpha — cheap, no texture re-upload.
			this.entity.rectangle.material = new C.ImageMaterialProperty({
				image: this.canvas,
				transparent: true,
				color: new C.Color(1, 1, 1, alpha),
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
