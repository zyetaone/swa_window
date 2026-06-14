/**
 * viirs-field — sample NASA VIIRS Black Marble night-lights as a brightness
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

const TILE_Z = 7;
// Canonical GIBS WMTS REST endpoint (epsg3857/best). PNG tiles, CORS-clean so
// the canvas read-back works. The older map1.vis.earthdata.nasa.gov/wmts-webmerc
// host that the Cesium layer string still uses now returns InvalidParameter.
const VIIRS_TILE = (z: number, y: number, x: number) =>
	`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;

export interface ViirsField {
	/** VIIRS luminance at a geographic point, 0 (dark) … 1 (bright core).
	 *  Nearest-pixel — cheapest, but snaps to the coarse ~1.2 km/px tile grid
	 *  (blocky for dense point placement). */
	sample(lat: number, lon: number): number;
	/** Bilinearly-interpolated luminance, 0 … 1. Smooths the coarse VIIRS
	 *  pixel grid so a field of points placed against it reads as a continuous
	 *  light carpet, not blocky clumps — and averages away single-pixel sensor
	 *  noise, so callers can use a LOWER brightness floor for wider spread
	 *  without picking up rural noise as orphan dots. */
	sampleBilinear(lat: number, lon: number): number;
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
