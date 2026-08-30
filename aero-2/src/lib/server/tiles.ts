/**
 * Tile server helpers — TILE_DIR resolution, path guard, PMTiles Range parsing, and LAN CORS.
 */
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// ── TILE_DIR Discovery ────────────────────────────────────────────────────────

function dirHasLayers(dir: string): boolean {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.some((e) => {
				try {
					return readdirSync(resolve(dir, e.name)).length > 0;
				} catch {
					return false;
				}
			});
	} catch {
		return false;
	}
}

export function resolveTileDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
	piDirExists: (path: string) => boolean = existsSync,
	dirHasContent: (path: string) => boolean = dirHasLayers
): string {
	if (env.TILE_DIR) return resolve(cwd, env.TILE_DIR);
	const piPath = '/opt/zyeta-aero/tiles';
	if (piDirExists(piPath)) return piPath;

	const local = resolve(cwd, 'static/tiles');
	if (dirHasContent(local)) return local;

	const parent = resolve(cwd, '../static/tiles');
	if (dirHasContent(parent)) return parent;

	return local;
}

// ── Path Guard & Local Resolution ─────────────────────────────────────────────

export interface ResolvedTile {
	filePath: string;
	notFound: boolean;
	forbidden: boolean;
}

const WMTS_TILE_PATH =
	/^(?<layer>[a-z0-9-]+)\/(?<z>\d+)\/(?<y>\d+)\/(?<x>\d+)\.(?<ext>jpg|jpeg|png)$/;

/**
 * Resolve a request path to a file INSIDE `root`, preventing traversal and symlink escapes.
 */
export function resolveLocalTile(root: string, subPath: string): ResolvedTile {
	const rootDir = root.replace(/\/+$/, '') + '/';
	const filePath = resolve(rootDir, subPath);
	if (!filePath.startsWith(rootDir)) return { filePath, notFound: false, forbidden: true };
	if (!existsSync(filePath)) return { filePath, notFound: true, forbidden: false };
	try {
		const realRoot = realpathSync(rootDir);
		const real = realpathSync(filePath);
		if (real !== realRoot && !real.startsWith(realRoot + '/')) {
			return { filePath, notFound: false, forbidden: true };
		}
	} catch {
		return { filePath, notFound: true, forbidden: false };
	}
	return { filePath, notFound: false, forbidden: false };
}

// ── Remote Fallback (Dev Only) ────────────────────────────────────────────────

export function remoteFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.AERO_TILE_REMOTE_FALLBACK === '0') return false;
	if (env.AERO_TILE_REMOTE_FALLBACK === '1') return true;
	return env.NODE_ENV === 'development';
}

/**
 * The MODIS day the imagery is frozen to. NOT `default`, which means "today".
 *
 * Three reasons, in order of how badly each bit:
 *
 * 1. MODIS true colour is a same-day swath, so it shows the weather. Asking
 *    for today over Hyderabad in August returns 99.5% cloud — the window goes
 *    white. A pinned clear day is the only way this reads as a view.
 * 2. Some days have no tile at all over a given city (2025-10-28 and
 *    2026-05-06 both return nothing over Denver). `default` gambles on that
 *    every midnight.
 * 3. Determinism. Three Pis booting either side of the GIBS daily update would
 *    fetch different rasters, and the panorama would disagree across the seam.
 *
 * Chosen by sweeping candidate days over EVERY location in the catalog and
 * checking each one actually returns a tile.
 *
 * 2026-04-15 was picked when the catalog held only Hyderabad and Denver, and it
 * is genuinely clear over both. It does NOT cover the eleven-location catalog:
 * MODIS is a swath instrument, so a single day has gaps between passes, and on
 * that date the Sahara tile 404s — as did the Pacific at the zoom the window
 * flies. An ocean location with no tile renders as a black void under a lit
 * sky, which is what surfaced this.
 *
 * 2026-08-23 returns a tile for all eleven. Verified per location, not assumed:
 * 04-15 scored 10/11 (missing desert), 08-20 10/11 (missing mumbai),
 * 08-22/23/24 all 11/11.
 *
 * To re-pin: sweep candidate days against every catalog entry at z9 and take
 * one that is 11/11. A day that is clear over one city is routinely a gap over
 * another, and adding a location can invalidate the pin.
 */
export const GIBS_DATE = '2026-08-23';

/**
 * VIIRS day/night band — the city-lights raster, for night.
 *
 * Pinned for the same reason GIBS_DATE is, and the layer and date must move
 * together: this is a daily product, so three Pis booting either side of the
 * update would light the cities differently across the panorama seam. The
 * gap-filled BRDF-corrected variant is the one that is usable as a picture —
 * the raw radiance band is speckled with orphan bright pixels.
 *
 * GoogleMapsCompatible_Level8 is the whole pyramid: there is no z9+. That is
 * fine, because it is a glow laid under the horizon haze, not detail.
 */
export const VIIRS_LAYER = 'VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance';
export const VIIRS_DATE = '2026-07-15';

export function remoteTileUrl(subPath: string): string | null {
	const m = subPath.match(WMTS_TILE_PATH);
	if (!m?.groups) return null;
	const { layer, z, y, x } = m.groups;
	switch (layer) {
		case 'terrarium':
			return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
		case 'gibs':
			return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
		case 'viirs':
			return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${VIIRS_LAYER}/default/${VIIRS_DATE}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
		default:
			return null;
	}
}

// ── Range Requests (PMTiles) ──────────────────────────────────────────────────

export interface ByteRange {
	start: number;
	end: number;
}

export function parseRange(
	header: string | null,
	size: number
): ByteRange | null | 'unsatisfiable' {
	if (!header) return null;
	const m = header.match(/^bytes=(\d*)-(\d*)$/);
	if (!m) return null;
	const [, rawStart, rawEnd] = m;
	if (rawStart === '' && rawEnd === '') return null;

	// A zero-length file satisfies no range at all. Without this, `bytes=-100`
	// against an empty file returned `{ start: 0, end: -1 }` -- which the route
	// turns into `Content-Range: bytes 0--1/0` and a read stream with a negative
	// end. The suffix branch never reached the `end < start` check below.
	if (size === 0) return 'unsatisfiable';

	if (rawStart === '') {
		const suffix = Number(rawEnd);
		if (suffix <= 0) return 'unsatisfiable';
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}

	const start = Number(rawStart);
	if (start >= size) return 'unsatisfiable';
	const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
	if (end < start) return 'unsatisfiable';
	return { start, end };
}

// ── LAN CORS (Multi-Pi Fleet) ─────────────────────────────────────────────────

/**
 * Origins allowed to read tiles cross-origin: the other panes on the wall.
 *
 * mDNS names and `localhost` only, until now -- which excluded the addresses
 * the fleet actually uses. `/api/status` advertises `lanIps` and
 * `primaryLanIp`, and those are IPv4 literals, so the one deployment this
 * allowlist exists for (one Pi serving 3.7 GB of tiles to its two neighbours)
 * was the one it rejected. Avahi is also not guaranteed on a kiosk image.
 *
 * Private ranges only, enumerated rather than pattern-matched on "looks
 * local": 10/8, 172.16-31/12, 192.168/16, 127/8 loopback, 169.254/16
 * link-local, and 100.64/10 -- the CGNAT block Tailscale assigns, which is how
 * these machines reach each other when they are not on the same switch. A
 * public address must never match: this header is what lets another origin
 * read a response.
 */
const LAN_HOST =
	/^(?:[a-zA-Z0-9-]+\.local|localhost|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/;

const LAN_ORIGIN = new RegExp(`^https?://${LAN_HOST.source.slice(1, -1)}(?::[0-9]{1,5})?$`);

export function lanCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
	if (!requestOrigin || !LAN_ORIGIN.test(requestOrigin)) {
		return {};
	}
	return {
		'Access-Control-Allow-Origin': requestOrigin,
		'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
		Vary: 'Origin'
	};
}

export function corsPreflight(methods: string): (event: { request: Request }) => Response {
	return ({ request }) => {
		const cors = lanCorsHeaders(request.headers.get('origin'));
		return new Response(null, {
			status: 204,
			headers:
				Object.keys(cors).length === 0 ? {} : { ...cors, 'Access-Control-Allow-Methods': methods }
		});
	};
}
