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

	const local = resolve(cwd, 'data/tiles');
	if (dirHasContent(local)) return local;

	const parent = resolve(cwd, '../data/tiles');
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
 * Chosen by sweeping candidate days over BOTH locations and scoring cloud and
 * no-data fraction: 2026-04-15 is 0.0% cloud over Hyderabad, 0.2% over Denver,
 * with no gaps. Winter dates score badly for Denver on snow, not cloud.
 *
 * To re-pin: re-run that sweep over every location in the catalog. A day that
 * is clear over one city is routinely cloud or gap over another.
 */
export const GIBS_DATE = '2026-04-15';

export function remoteTileUrl(subPath: string): string | null {
	const m = subPath.match(WMTS_TILE_PATH);
	if (!m?.groups) return null;
	const { layer, z, y, x } = m.groups;
	switch (layer) {
		case 'terrarium':
			return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
		case 'gibs':
			return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${GIBS_DATE}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
		case 'usgs':
			return `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;
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

const LAN_ORIGIN = /^https?:\/\/([a-zA-Z0-9-]+\.local|localhost)(:[0-9]{1,5})?$/;

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
