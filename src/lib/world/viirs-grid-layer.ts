/**
 * VIIRS grid imagery layer — procedural city-block texture rendered into
 * a canvas and added to Cesium as a SingleTileImageryProvider covering a
 * lat/lon rectangle around the current location.
 *
 * Reframe context (2026-05-22): replaces the prior CSS-DOM
 * ViirsGridEffect, which was screen-anchored and didn't parallax with
 * the camera, ignored depth/occlusion, and read as "tint on the glass"
 * rather than "city blocks on the ground." This is the same intensity
 * field, painted into a tile that lives IN THE MAP — world-anchored,
 * occluded by terrain, lit by Cesium's scene, parallax-correct on bank.
 *
 * Cost: one canvas paint per location change (~3 ms for 1024×1024 at
 * 64×64 cells), one blob conversion (~5 ms), then Cesium owns the
 * GPU texture. No per-frame work.
 */

import type * as CesiumType from 'cesium';

const CANVAS_SIZE = 1024;
const GRID = 64;                       // cells per axis — perceptual block density
const RECT_RADIUS_DEG = 3;             // half-extent of the rectangle in degrees
const BLOCK_WIDTH_FRACTION = 0.55;     // narrow stripes read as buildings, not full cells

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

			// Pre-pass: soft glow via canvas shadow for the brightest cells.
			if (intensity > 0.4) {
				ctx.shadowColor = `rgba(${R}, ${G}, ${B}, ${(intensity * 0.6).toFixed(2)})`;
				ctx.shadowBlur = 4 + intensity * 10;
				ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha.toFixed(2)})`;
				ctx.fillRect(x, y, w, h);
				ctx.shadowBlur = 0;
			} else {
				ctx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha.toFixed(2)})`;
				ctx.fillRect(x, y, w, h);
			}
		}
	}
}

/**
 * Convert canvas → blob URL. Some Pi-deployed Chromium builds choke on
 * dataURL paths for SingleTileImageryProvider; blob: URLs work universally.
 */
function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error('canvas.toBlob returned null'));
				return;
			}
			resolve(URL.createObjectURL(blob));
		}, 'image/png');
	});
}

export class ViirsGridLayer {
	private canvas: HTMLCanvasElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private layer: any = null;
	private lastBlobUrl: string | null = null;
	private lastKey = '';
	private generation = 0;
	private updating = false;

	constructor(
		private C: typeof CesiumType,
		private viewer: CesiumType.Viewer,
	) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = CANVAS_SIZE;
		this.canvas.height = CANVAS_SIZE;
	}

	/**
	 * Update (or remove) the imagery layer based on current state. Throttled
	 * via a coarse cache key so per-frame calls are essentially free unless
	 * something material changed.
	 *
	 * @param lat     current view latitude
	 * @param lon     current view longitude
	 * @param density location.scene.nightLightDensity (0..1)
	 * @param alpha   final layer alpha (already gated by nightFactor)
	 */
	async update(lat: number, lon: number, density: number, alpha: number): Promise<void> {
		if (alpha < 0.005 || density < 0.02) {
			this.remove();
			this.lastKey = '';
			return;
		}

		// Coarse cache key — re-render only when one of these crosses a step.
		// Lat/lon rounded to 0.5° (~55 km bucket — far below the 3° rectangle
		// half-extent, so we re-render long before the rectangle drifts off
		// the visible area).
		const key = `${Math.round(lat * 2)}|${Math.round(lon * 2)}|${density.toFixed(2)}`;
		if (key === this.lastKey) {
			// Just adjust alpha — no re-paint needed.
			if (this.layer) this.layer.alpha = alpha;
			return;
		}

		if (this.updating) return;       // skip overlapping calls
		this.updating = true;
		const gen = ++this.generation;
		this.lastKey = key;

		try {
			paintGrid(this.canvas, lat, lon, density);
			const url = await canvasToBlobUrl(this.canvas);

			// If another update started while we were awaiting toBlob, bail
			// without leaking the layer.
			if (gen !== this.generation) {
				URL.revokeObjectURL(url);
				return;
			}

			const rect = this.C.Rectangle.fromDegrees(
				lon - RECT_RADIUS_DEG,
				lat - RECT_RADIUS_DEG,
				lon + RECT_RADIUS_DEG,
				lat + RECT_RADIUS_DEG,
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const provider: any = await (this.C as any).SingleTileImageryProvider.fromUrl(url, {
				rectangle: rect,
			});

			// Remove the old layer + blob AFTER the new provider resolved so
			// there's no on-screen gap during the swap.
			const oldLayer = this.layer;
			const oldUrl = this.lastBlobUrl;

			this.layer = this.viewer.imageryLayers.addImageryProvider(provider);
			this.layer.alpha = alpha;
			this.lastBlobUrl = url;

			if (oldLayer) this.viewer.imageryLayers.remove(oldLayer, false);
			if (oldUrl) URL.revokeObjectURL(oldUrl);
		} finally {
			this.updating = false;
		}
	}

	remove(): void {
		if (this.layer) {
			this.viewer.imageryLayers.remove(this.layer, false);
			this.layer = null;
		}
		if (this.lastBlobUrl) {
			URL.revokeObjectURL(this.lastBlobUrl);
			this.lastBlobUrl = null;
		}
	}

	destroy(): void {
		this.remove();
		this.generation = -1;        // poison any in-flight update
	}
}
