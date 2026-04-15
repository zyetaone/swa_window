/**
 * Cesium Global Config
 *
 * Centralizes Ion tokens and environmental settings for the Cesium engine.
 */

import type * as CesiumType from 'cesium';

// Environment markers
export const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || null;
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || null;
export const SENTINEL2 = import.meta.env.VITE_SENTINEL2 === 'true' || false;

/**
 * NASA VIIRS City Lights (Earth at Night, 2012 composite).
 * Free, public, no auth — served via NASA's GIBS tile server.
 * Provides photographic city-glow appearance — complements CartoDB Dark's vector road detail.
 */
export const VIIRS_NIGHT_LIGHTS_URL =
	'https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg';

/** CartoDB Dark basemap — dark vector tiles with crisp road + building edge detail. */
export const CARTODB_DARK_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png';

/**
 * Sentinel-2 L2A via RODA/Sentinel-Hub public bucket.
 * Band L2A = natural color RGB composite.
 * Path format: tiles/{z}/{x}/{y}/L2A/{date}.jpg
 *
 * NOTE: Sentinel-2 uses a non-standard z/x/y path structure.
 * For Cesium integration, a tiling proxy (e.g., tileserver-gl) is required
 * to convert Sentinel-2's format to standard z/x/y.
 */
export function getSentinel2TileUrl(z: number, x: number, y: number): string {
	const date = '2023-07-15';
	return `https://roda.sentinel-hub.com/sentinel-s2-l2a/tiles/${z}/${x}/${y}/L2A/${date}.jpg`;
}

/**
 * Access the Cesium Ion token from environment variables.
 * Falls back to null if the default placeholder is detected.
 */
export function getIonToken(): string | null {
	const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
	if (!token || token === 'your-cesium-ion-token-here') return null;
	return token;
}

/**
 * Perform one-time global initialization for the Cesium module.
 */
export function initCesiumGlobal(C: typeof CesiumType): void {
	const token = getIonToken();
	if (token) {
		C.Ion.defaultAccessToken = token;
	}

	// Set base URL for static assets (workers, etc.)
	(globalThis as any).CESIUM_BASE_URL = '/cesiumStatic';
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
	shadows: false,
	useBrowserRecommendedResolution: false,
	contextOptions: {
		webgl: { alpha: false, antialias: true, preserveDrawingBuffer: true },
	},
} as const;

/**
 * Get the primary satellite imagery URL.
 * Priority: Mapbox (if token) → Sentinel-2 (if enabled, requires tiling proxy) → ESRI World Imagery (fallback, no auth)
 *
 * NOTE: Sentinel-2 via RODA uses non-standard z/x/y path structure (tiles/{z}/{x}/{y}/L2A/{date}.jpg).
 * A tiling proxy (e.g., tileserver-gl) is required for direct Cesium integration.
 */
export function getSatelliteImageryUrl(): string {
	if (TILE_SERVER_URL) return `${TILE_SERVER_URL}/imagery/{z}/{x}/{y}.jpg`;
	if (MAPBOX_TOKEN) return `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX_TOKEN}`;
	if (SENTINEL2) return getSentinel2TileUrl(0, 0, 0); // NOTE: requires tiling proxy for standard z/x/y
	return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
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
