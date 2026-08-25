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

export interface SafeResolveResult {
	filePath: string;
	notFound: boolean;
	forbidden: boolean;
}

export function safeResolveWithin(root: string, subPath: string): SafeResolveResult {
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

/** WMTS on-disk layout: `{layer}/{z}/{y}/{x}.ext` */
const WMTS_TILE_PATH =
	/^(?<layer>[a-z0-9-]+)\/(?<z>\d+)\/(?<y>\d+)\/(?<x>\d+)\.(?<ext>jpg|jpeg|png)$/;

export function resolveLocalTile(root: string, subPath: string): SafeResolveResult {
	return safeResolveWithin(root, subPath);
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

export function lanCorsHeaders(requestOrigin: string | null | undefined): Record<string, string> {
	if (!requestOrigin || !LAN_ORIGIN.test(requestOrigin)) {
		return {};
	}
	return {
		'Access-Control-Allow-Origin': requestOrigin,
		Vary: 'Origin'
	};
}

export function lanCorsHeadersFull(
	requestOrigin: string | null | undefined,
	methods = 'GET, POST, OPTIONS'
): Record<string, string> {
	const base = lanCorsHeaders(requestOrigin);
	if (Object.keys(base).length === 0) return {};
	return {
		...base,
		'Access-Control-Allow-Methods': methods,
		'Access-Control-Allow-Headers': 'Content-Type, Authorization'
	};
}

export function corsPreflight(methods: string): (event: { request: Request }) => Response {
	return ({ request }) =>
		new Response(null, {
			status: 204,
			headers: lanCorsHeadersFull(request.headers.get('origin'), methods)
		});
}
