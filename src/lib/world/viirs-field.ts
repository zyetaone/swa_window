/**
 * viirs-field — sample the NASA VIIRS night-lights raster as a brightness
 * field, so the stylised Three night-light layers DERIVE from the same
 * satellite ground-truth as the Cesium VIIRS imagery.
 *
 * Why: OsmRoads coloured by road class and OsmBuildingEdges by a position hash
 * are arbitrary — they don't know where the lights actually are. Sampling VIIRS
 * lets the neon brighten over real lit cores and fade over dark outskirts, and
 * lets the wing catch warm up-light only when it's actually over a lit city.
 * One field, read by roads + building edges + the wing → one integrated city.
 *
 * Mechanics: fetch the single WebMercator tile (~z7, ~312 km — one tile covers
 * a metro) covering the location, draw it to a 256² canvas ONCE, and expose a
 * cheap `sample(lat, lon) → 0..1` luminance lookup. Per-location cache; the
 * fetch + decode happen once, sampling is an array index (Pi-cheap, no per-frame
 * cost). Deterministic (same day's tile on every Pi) → 3-Pi panorama safe.
 *
 * Graceful degradation: a network load error is retried up to 3 times with a
 * linear backoff (1.5 s, 3 s) — a blip at kiosk boot must not mean dark/static
 * neon until reload. Only after 3 failures (or a CORS-tainted canvas, which is
 * deterministic, not transient) is the entry marked 'failed' permanently and
 * callers get null — they fall back to their static colours. No hard
 * dependency on the network.
 *
 * Waiter semantics: `onReady` callbacks stay registered across retries and are
 * notified exactly once, on TERMINAL resolution (success or permanent failure).
 * Retryable failures do not notify — a notified waiter would call back into
 * getViirsField, read null, and have to re-register anyway; keeping it
 * registered is the simplest correct behaviour. Use `removeViirsWaiter` to
 * cancel a registration on unmount.
 */

import { VIIRS_GIBS_BASE } from './viirs-endpoint';

const TILE_Z = 7;
// Endpoint SSOT shared with the Cesium imagery layer — see world/viirs-endpoint.
// PNG tiles, CORS-clean so the canvas read-back works.
const VIIRS_TILE = (z: number, y: number, x: number) =>
	`${VIIRS_GIBS_BASE}/${z}/${y}/${x}.png`;

export interface ViirsField {
	/** VIIRS luminance at a geographic point, 0 (dark) … 1 (bright core).
	 *  Nearest-pixel — cheapest, but snaps to the coarse ~1.2 km/px tile grid
	 *  (blocky for dense point placement). */
	sample(lat: number, lon: number): number;
	/** Bilinearly-interpolated luminance, 0 … 1. Smooths the coarse VIIRS
	 *  pixel grid so a field of points placed against it reads as a continuous
	 *  light carpet, not blocky clumps. Noise-robustness does NOT come from the
	 *  blend (sampled at a hot pixel's own centre, bilinear returns it at full
	 *  value) — it comes from despeckle() cleaning the tile once at decode. */
	sampleBilinear(lat: number, lon: number): number;
}

/**
 * Isolated-hot-pixel suppressor, run ONCE on the decoded tile (RDT-192 v2).
 *
 * The orphan-dot pathology is salt noise in the SOURCE raster: a lone lit
 * pixel in dark rural cells clears any low brightness floor and spawns a
 * bokeh dot / neon glow in the void. Per-sample defences (the retired
 * sampleArea neighbourhood mean) fixed one consumer at a time and traded
 * away sub-pixel smoothness; fixing the data at decode fixes every consumer
 * (bokeh carpet, neon roads, wing up-light) through the samplers they
 * already use.
 *
 * Deliberately NOT a median/box filter: VIIRS is full of 1-px-wide road and
 * filament strings a 3×3 median would erase. A pixel is suppressed only when
 * it is bright AND its 8-neighbour mean is near-dark — a line pixel has ≥2
 * lit neighbours, so lines, blocks, and suburb gradients pass byte-identical.
 * Border ring is left untouched (a metro never sits on the tile edge that
 * matters, and edge clamping would double-count).
 *
 * Pure function of the tile bytes → identical on all 3 Pis (invariant #4).
 * O(w·h), ~0.6M adds for 256² — once per tile load, off the frame loop.
 * Returns the number of suppressed pixels (observability + tests).
 */
export function despeckle(data: Uint8ClampedArray, w: number, h: number): number {
	// Snapshot luminance first so suppression decisions never cascade.
	const lum = new Float32Array(w * h);
	for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
		lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
	}
	// A pixel is an orphan when brighter than HOT (above sensor black) and its
	// neighbourhood mean is below ISOLATION × its own value.
	// HOT must sit AT OR BELOW every consumer's brightness floor or a band of
	// un-suppressed orphans survives above the gate: CityLightField culls at
	// 0.05 (= 12.75/255), so HOT=12 leaves no gap (review finding, Jul 9).
	// ISOLATION 0.10 < 1/8: ONE equal-brightness neighbour is enough to keep a
	// pixel, so the endpoints of 1-px road strings survive; only pixels with
	// essentially no lit neighbour are folded. Known accepted limit: a 2-px
	// noise PAIR mutually shields itself and survives — that shape is rare in
	// VIIRS composites and reads as a tiny hamlet, not an artifact.
	const HOT = 12; // ≈0.047 luminance
	const ISOLATION = 0.10;
	let suppressed = 0;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			const v = lum[i];
			if (v <= HOT) continue;
			const mean =
				(lum[i - w - 1] + lum[i - w] + lum[i - w + 1] +
					lum[i - 1] + lum[i + 1] +
					lum[i + w - 1] + lum[i + w] + lum[i + w + 1]) / 8;
			if (mean >= v * ISOLATION) continue;
			// Fold the orphan down to its neighbourhood mean, preserving hue.
			const k = mean / v;
			const p = i * 4;
			data[p] = data[p] * k;
			data[p + 1] = data[p + 1] * k;
			data[p + 2] = data[p + 2] * k;
			suppressed++;
		}
	}
	return suppressed;
}

// Fractional WebMercator tile coordinates (so we can sample sub-tile pixels).
function lonToTileXf(lon: number, z: number): number {
	return ((lon + 180) / 360) * (1 << z);
}
function latToTileYf(lat: number, z: number): number {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z);
}

type Entry = ViirsField | 'loading' | 'failed';
const _cache = new Map<string, Entry>();
const _waiters = new Map<string, Set<() => void>>();
// Per-tile network-error counter. < MAX_FAILS → retryable (entry deleted +
// background retry scheduled); >= MAX_FAILS → 'failed' permanently.
const _fails = new Map<string, number>();
const MAX_FAILS = 3;
const RETRY_BASE_MS = 1500;

function tileKey(lat: number, lon: number): { key: string; tx: number; ty: number } {
	const tx = Math.floor(lonToTileXf(lon, TILE_Z));
	const ty = Math.floor(latToTileYf(lat, TILE_Z));
	return { key: `${TILE_Z}/${ty}/${tx}`, tx, ty };
}

/**
 * Deregister an `onReady` callback previously passed to `getViirsField` for
 * the tile covering (lat, lon). Call from component cleanup — without this a
 * still-pending load would hold the closure (and whatever it captures) until
 * the tile resolves. No-op if the callback was never registered or already
 * notified.
 */
export function removeViirsWaiter(lat: number, lon: number, onReady: () => void): void {
	const { key } = tileKey(lat, lon);
	const s = _waiters.get(key);
	if (!s) return;
	s.delete(onReady);
	if (s.size === 0) _waiters.delete(key);
}

/**
 * Get the VIIRS field for the tile covering (lat, lon). Returns the field if it
 * is already loaded, otherwise null + kicks off the async load. Pass `onReady`
 * to be notified when an in-flight load completes (e.g. to trigger a rebuild).
 */
export function getViirsField(lat: number, lon: number, onReady?: () => void): ViirsField | null {
	if (typeof document === 'undefined') return null; // SSR guard
	const z = TILE_Z;
	const { key, tx, ty } = tileKey(lat, lon);

	const e = _cache.get(key);
	if (e && e !== 'loading' && e !== 'failed') return e;
	if (e === 'failed') return null;
	if (onReady) {
		let s = _waiters.get(key);
		if (!s) _waiters.set(key, (s = new Set()));
		s.add(onReady);
	}
	if (e === 'loading') return null;
	_cache.set(key, 'loading');

	const notify = () => {
		const s = _waiters.get(key);
		if (s) {
			s.forEach((fn) => fn());
			_waiters.delete(key);
		}
	};

	const img = new Image();
	img.crossOrigin = 'anonymous';
	img.onload = () => {
		try {
			const cv = document.createElement('canvas');
			cv.width = 256;
			cv.height = 256;
			const c2 = cv.getContext('2d', { willReadFrequently: true });
			if (!c2) throw new Error('no 2d context');
			c2.drawImage(img, 0, 0, 256, 256);
			const data = c2.getImageData(0, 0, 256, 256).data;
			despeckle(data, 256, 256);
			// Luminance of pixel (px,py) — VIIRS PNG is already a brightness map.
			const lumAt = (px: number, py: number): number => {
				const i = (py * 256 + px) * 4;
				return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
			};
			_cache.set(key, {
				sample(la: number, lo: number): number {
					const fx = (lonToTileXf(lo, z) - tx) * 256;
					const fy = (latToTileYf(la, z) - ty) * 256;
					const px = fx < 0 ? 0 : fx > 255 ? 255 : fx | 0;
					const py = fy < 0 ? 0 : fy > 255 ? 255 : fy | 0;
					return lumAt(px, py);
				},
				sampleBilinear(la: number, lo: number): number {
					// Fractional pixel position, clamped to the 0..255 grid.
					let fx = (lonToTileXf(lo, z) - tx) * 256;
					let fy = (latToTileYf(la, z) - ty) * 256;
					fx = fx < 0 ? 0 : fx > 255 ? 255 : fx;
					fy = fy < 0 ? 0 : fy > 255 ? 255 : fy;
					const x0 = fx | 0;
					const y0 = fy | 0;
					const x1 = x0 < 255 ? x0 + 1 : 255;
					const y1 = y0 < 255 ? y0 + 1 : 255;
					const dx = fx - x0;
					const dy = fy - y0;
					// Bilinear blend of the 4 surrounding pixels.
					const top = lumAt(x0, y0) * (1 - dx) + lumAt(x1, y0) * dx;
					const bot = lumAt(x0, y1) * (1 - dx) + lumAt(x1, y1) * dx;
					return top * (1 - dy) + bot * dy;
				},
			});
		} catch {
			// Tainted canvas (CORS) or decode failure → deterministic, not a
			// transient network blip — fail permanently, fall back to static colours.
			_cache.set(key, 'failed');
		}
		_fails.delete(key);
		notify();
	};
	img.onerror = () => {
		const fails = (_fails.get(key) ?? 0) + 1;
		_fails.set(key, fails);
		if (fails >= MAX_FAILS) {
			_cache.set(key, 'failed'); // terminal — give up, notify waiters once
			notify();
			return;
		}
		// Retryable network error (kiosk-boot blip): delete the entry so the next
		// getViirsField call re-enters the load path, and schedule a background
		// retry with linear backoff. Waiters stay registered — they are only
		// notified on terminal success/failure (see module doc).
		_cache.delete(key);
		setTimeout(() => getViirsField(lat, lon), RETRY_BASE_MS * fails);
	};
	img.src = VIIRS_TILE(z, ty, tx);
	return null;
}
