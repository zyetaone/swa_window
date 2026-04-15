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
 * EOX Sentinel-2 Cloudless 2024 — natural-color cloudless composite from
 * Sentinel-2 satellite imagery. Beautiful, free, no auth.
 *
 * Caveats vs ESRI:
 *   - Max zoom 14 (vs ESRI 19) — fine at cruise altitude (z14 ≈ 10m/pixel)
 *   - WebMercator (3857) tiling scheme — must construct provider with
 *     `tilingScheme: new Cesium.WebMercatorTilingScheme()`
 *   - URL uses {z}/{y}/{x} order (y before x) — natural for WMTS
 */
export const SENTINEL2_EOX_URL =
	'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg';

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
 * Imagery source configuration — captures everything CesiumManager needs to
 * construct a UrlTemplateImageryProvider (URL + max zoom + tiling scheme hint).
 */
export interface ImageryConfig {
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
		return { url: `${TILE_SERVER_URL}/imagery/{z}/{x}/{y}.jpg`, maxZoom: 17, webMercator: false, label: 'local-tile-server' };
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
