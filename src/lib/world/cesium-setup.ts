/**
 * Cesium Global Config
 *
 * Centralizes Ion tokens and environmental settings for the Cesium engine.
 */

import type * as CesiumType from 'cesium';

// Environment markers — exported ones are imported elsewhere; others are
// private to this module's getSatelliteImagery().
export const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || null;
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || null;


/**
 * EOX Sentinel-2 Cloudless 2024 — natural-color cloudless composite from
 * Sentinel-2 satellite imagery. Free, no auth.
 *
 * Caveats vs ESRI:
 *   - Max zoom 14 (vs ESRI 19) — fine at cruise altitude (z14 ≈ 10 m/pixel)
 *   - WebMercator (3857) tiling scheme — construct provider with
 *     `tilingScheme: new Cesium.WebMercatorTilingScheme()`
 *   - URL uses {z}/{y}/{x} order (y before x) — natural for WMTS
 */
const SENTINEL2_EOX_URL =
	'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg';

/** Build-time token — only present when VITE_CESIUM_ION_TOKEN was set at
 *  `vite build`. That's the dev path; a CI-built artifact deliberately has
 *  none, so the runtime endpoint below is what feeds a fielded Pi. */
function buildTimeIonToken(): string | null {
	const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
	if (!token || token === 'your-cesium-ion-token-here') return null;
	return token;
}

// Resolved once by resolveIonToken() and cached for the tab's lifetime. Kept
// as module state so getIonToken() can stay SYNCHRONOUS — compose.ts calls it
// later, mid-scene, for the buildings tileset, and making that path async
// would ripple through the whole Cesium layer for no benefit.
let resolvedToken: string | null = null;
let tokenResolved = false;

/**
 * Fetch the Ion token from the Pi's localhost-only endpoint, falling back to
 * the build-time value. Safe to call repeatedly — resolves at most once.
 *
 * Order matters: runtime FIRST. A CI-built artifact has no build-time token,
 * and a locally-built dev bundle has no server env — so whichever exists wins,
 * and a Pi that has both prefers the one in /etc/aero/config.env (the value an
 * operator can rotate without rebuilding).
 */
export async function resolveIonToken(): Promise<string | null> {
	if (tokenResolved) return resolvedToken;
	let runtime: string | null = null;
	try {
		const res = await fetch('/api/internal/ion-token', { cache: 'no-store' });
		if (res.ok) {
			const body = (await res.json()) as { token?: unknown };
			if (typeof body.token === 'string' && body.token.length > 0) runtime = body.token;
		}
	} catch {
		// Offline, non-localhost, or endpoint absent (older build) — fall through.
	}
	resolvedToken = runtime ?? buildTimeIonToken();
	tokenResolved = true;
	return resolvedToken;
}

/**
 * Access the Cesium Ion token. Synchronous by design (see above).
 *
 * Before resolveIonToken() completes this returns the build-time token, which
 * is null on a CI-built artifact — so call sites that gate features on it
 * (compose.ts buildings/terrain) must run AFTER initCesiumGlobal, which they
 * do: the manager is constructed on the line following it.
 */
export function getIonToken(): string | null {
	return tokenResolved ? resolvedToken : buildTimeIonToken();
}

/**
 * Perform one-time global initialization for the Cesium module.
 * Async since Phase 19: the Ion token is fetched at runtime so it no longer
 * has to be baked into the bundle.
 */
export async function initCesiumGlobal(C: typeof CesiumType): Promise<void> {
	const token = await resolveIonToken();
	if (token) {
		C.Ion.defaultAccessToken = token;
	}

	// Set base URL for static assets (workers, etc.)
	(globalThis as any).CESIUM_BASE_URL = '/cesiumStatic';
}

/** Test-only reset hook — module state is per-process. */
export function __resetIonTokenCacheForTests(): void {
	resolvedToken = null;
	tokenResolved = false;
}

/**
 * Shared Cesium.Viewer constructor options — strips all built-in widgets
 * (toolbar, geocoder, animation, etc.) so the canvas is purely a render surface.
 *
 * `webgl` defaults to alpha=false (opaque); pass `webgl: { alpha: true }`
 * via override when the page wants a CSS gradient to show through.
 */
export const VIEWER_OPTIONS = {
	baseLayer: false as const,
	animation: false,
	baseLayerPicker: false,
	fullscreenButton: false,
	vrButton: false,
	geocoder: false,
	homeButton: false,
	infoBox: false,
	sceneModePicker: false,
	selectionIndicator: false,
	timeline: false,
	navigationHelpButton: false,
	navigationInstructionsInitiallyVisible: false,
	// Enable shadow map so OSM Buildings + terrain cast real shadows at
	// dawn/dusk. Sun position is synced from model.timeOfDay in syncClock,
	// so shadow direction lines up with the in-scene lighting.
	shadows: true,
	useBrowserRecommendedResolution: false,
	contextOptions: {
		webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true },
	},
} as const;

/**
 * Imagery source configuration — captures everything CesiumManager needs to
 * construct a UrlTemplateImageryProvider (URL + max zoom + tiling scheme hint).
 */
interface ImageryConfig {
	url: string;
	maxZoom: number;
	/** Set true for sources that use WebMercator tiling (e.g. EOX, Mapbox). */
	webMercator: boolean;
	/** Human-readable label for logs/credits. */
	label: string;
}

/**
 * Get primary satellite imagery configuration.
 * Priority: Local tile server → Mapbox → EOX Sentinel-2 Cloudless → ESRI World Imagery
 *
 * EOX Sentinel-2 is the default (no Mapbox token needed) — natural cloudless
 * composite, gorgeous at cruise altitude. ESRI is the last-resort fallback
 * if you explicitly disable Sentinel-2 via VITE_SENTINEL2=false.
 */
export function getSatelliteImagery(): ImageryConfig {
	if (TILE_SERVER_URL) {
		// Local cache populated by tools/tile-packager. Sentinel-2 path layout
		// matches the packager's storagePath: `eox-sentinel2/{z}/{y}/{x}.jpg`.
		// When the cache misses, the device just shows the base color for that
		// tile until the next user-initiated load fills it.
		return {
			url: `${TILE_SERVER_URL}/eox-sentinel2/{z}/{y}/{x}.jpg`,
			maxZoom: 12,
			webMercator: true,
			label: 'local-eox-sentinel2',
		};
	}
	if (MAPBOX_TOKEN) {
		return {
			url: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`,
			maxZoom: 19,
			webMercator: true,
			label: 'mapbox-satellite',
		};
	}
	// Default: EOX Sentinel-2 Cloudless. Set VITE_SENTINEL2=false to opt out.
	const useSentinel = import.meta.env.VITE_SENTINEL2 !== 'false';
	if (useSentinel) {
		return { url: SENTINEL2_EOX_URL, maxZoom: 14, webMercator: true, label: 'eox-sentinel2' };
	}
	return {
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		maxZoom: 19,
		webMercator: false,
		label: 'esri-world-imagery',
	};
}

/**
 * Check if the local tile server is online.
 */
export async function checkLocalTileServer(): Promise<boolean> {
	if (!TILE_SERVER_URL) return false;
	try {
		const resp = await fetch(`${TILE_SERVER_URL}/health`, {
			signal: AbortSignal.timeout(500)
		});
		return resp.ok;
	} catch {
		return false;
	}
}
