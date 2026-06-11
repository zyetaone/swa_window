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
 * Graceful degradation: if the tile fails to load OR the canvas read-back is
 * blocked (CORS taint), the entry is marked 'failed' and callers get null —
 * they fall back to their static colours. No hard dependency on the network.
 */

const TILE_Z = 7;
// Canonical GIBS WMTS REST endpoint (epsg3857/best). PNG tiles, CORS-clean so
// the canvas read-back works. The older map1.vis.earthdata.nasa.gov/wmts-webmerc
// host that the Cesium layer string still uses now returns InvalidParameter.
const VIIRS_TILE = (z: number, y: number, x: number) =>
	`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;

export interface ViirsField {
	/** VIIRS luminance at a geographic point, 0 (dark) … 1 (bright core). */
	sample(lat: number, lon: number): number;
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

/**
 * Get the VIIRS field for the tile covering (lat, lon). Returns the field if it
 * is already loaded, otherwise null + kicks off the async load. Pass `onReady`
 * to be notified when an in-flight load completes (e.g. to trigger a rebuild).
 */
export function getViirsField(lat: number, lon: number, onReady?: () => void): ViirsField | null {
	if (typeof document === 'undefined') return null; // SSR guard
	const z = TILE_Z;
	const tx = Math.floor(lonToTileXf(lon, z));
	const ty = Math.floor(latToTileYf(lat, z));
	const key = `${z}/${ty}/${tx}`;

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
			_cache.set(key, {
				sample(la: number, lo: number): number {
					const fx = (lonToTileXf(lo, z) - tx) * 256;
					const fy = (latToTileYf(la, z) - ty) * 256;
					const px = fx < 0 ? 0 : fx > 255 ? 255 : fx | 0;
					const py = fy < 0 ? 0 : fy > 255 ? 255 : fy | 0;
					const i = (py * 256 + px) * 4;
					// VIIRS jpg is already a brightness map; luminance of RGB.
					return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
				},
			});
		} catch {
			// Tainted canvas (CORS) or decode failure → fall back to static colours.
			_cache.set(key, 'failed');
		}
		notify();
	};
	img.onerror = () => {
		_cache.set(key, 'failed');
		notify();
	};
	img.src = VIIRS_TILE(z, ty, tx);
	return null;
}
