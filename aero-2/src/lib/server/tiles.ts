/**
 * Tile server helpers — TILE_DIR resolution, path guard, LAN CORS.
 */
import { existsSync, realpathSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ── TILE_DIR ───────────────────────────────────────────────────────────────────

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

// ── Path guard ─────────────────────────────────────────────────────────────────

export interface ResolvedTile {
	filePath: string;
	notFound: boolean;
	forbidden: boolean;
}

/** WMTS on-disk layout: `{layer}/{z}/{y}/{x}.ext` */
const WMTS_TILE_PATH =
	/^(?<layer>[a-z0-9-]+)\/(?<z>\d+)\/(?<y>\d+)\/(?<x>\d+)\.(?<ext>jpg|jpeg|png)$/;

/**
 * Resolve a request path to a file INSIDE `root`, or refuse.
 *
 * The `startsWith` check stops `../` traversal, and the `realpath` check stops
 * a symlink inside the tile pack pointing out of it. Both matter: this maps a
 * URL straight onto the filesystem of a device on someone's office wall.
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

/**
 * Dev-only escape hatch when the local pack is sparse; `AERO_TILE_REMOTE_FALLBACK`
 * forces it either way.
 *
 * Fails CLOSED on an unset NODE_ENV. A bare systemd ExecStart sets no NODE_ENV,
 * and the old `!== 'production'` test read that absence as "development" — so the
 * kiosk would have proxied the public internet on every local miss, silently,
 * which is the one thing the fleet must not do. Only an explicit `development`
 * opts in; `vite dev` sets it for us.
 */
export function remoteFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.AERO_TILE_REMOTE_FALLBACK === '0') return false;
	if (env.AERO_TILE_REMOTE_FALLBACK === '1') return true;
	return env.NODE_ENV === 'development';
}

/**
 * Remote origin when the local pack is sparse (dev / partial cache). This is
 * the ONLY place any of these hosts is named — the client only ever asks
 * `/api/tiles/...`, so "does this kiosk reach the internet, and for what" has
 * exactly one answer, in one file.
 */
export function remoteTileUrl(subPath: string): string | null {
	const m = subPath.match(WMTS_TILE_PATH);
	if (!m?.groups) return null;
	const { layer, z, y, x } = m.groups;
	switch (layer) {
		// Elevation. Public domain, no key.
		case 'terrarium':
			return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
		// Base colour. Public domain. `default` asks GIBS for the best available
		// date instead of a hardcoded one, which would silently go stale.
		case 'gibs':
			return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
		// Detail colour. Public domain, US-only — resolveLocalTile 404s silently
		// outside NAIP coverage, and the client already gates the layer off there.
		case 'usgs':
			return `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;
		default:
			return null;
	}
}

// ── CORS ───────────────────────────────────────────────────────────────────────

const LAN_ORIGIN = /^https?:\/\/([a-zA-Z0-9-]+\.local|localhost)(:[0-9]{1,5})?$/;

/**
 * CORS for the panorama: the other Pis on the wall are separate origins
 * (`aero-display-01.local`), so they need this to share one tile server. Any
 * origin off the LAN gets nothing back, which is the point of the allowlist.
 */
export function lanCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
	if (!requestOrigin || !LAN_ORIGIN.test(requestOrigin)) {
		return {};
	}
	return {
		'Access-Control-Allow-Origin': requestOrigin,
		Vary: 'Origin'
	};
}

/**
 * Preflight responder. `Headers.get` is case-insensitive per the Fetch spec, so
 * 'origin' here and 'Origin' at the call site are the same lookup.
 */
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
