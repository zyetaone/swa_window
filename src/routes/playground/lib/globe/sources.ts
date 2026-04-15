/**
 * Central registry of satellite/map imagery sources.
 * Imported by both playground and production so there's a single source of truth.
 */

/** Generic identifier for an imagery tile source. */
export interface ImagerySource {
	/** Stable ID for lookup/state */
	id: string;
	/** Human-readable label for UI */
	label: string;
	/** Tile URL template ({z}/{x}/{y} or {z}/{y}/{x}), or PMTiles path if isPmtiles */
	url: string;
	/** Short explanation for UI (auth, coverage, limitations) */
	note: string;
	/** Attribution string shown by the renderer */
	attribution?: string;
	/** True = load via PMTiles protocol */
	isPmtiles?: boolean;
	/** Maximum zoom level supported by the provider */
	maxZoom?: number;
}

/**
 * Cesium accepts any XYZ tile URL via UrlTemplateImageryProvider.
 * ESRI works here because Cesium doesn't need CORS for texture use the same way MapLibre does.
 */
export const CESIUM_SOURCES: readonly ImagerySource[] = [
	{
		id: 'esri',
		label: 'ESRI World Imagery',
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		note: 'No auth, z19 max, global',
		attribution: '© ESRI',
		maxZoom: 19,
	},
] as const;

/**
 * MapLibre requires CORS-enabled tile endpoints (WebGL texture use is tainted otherwise).
 * ESRI/USGS direct lack CORS headers — need a server proxy. Included here with proxied URL.
 */
export const MAPLIBRE_SOURCES: readonly ImagerySource[] = [
	{
		id: 'eox-s2',
		label: 'Sentinel-2 Cloudless (EOX)',
		url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
		note: 'Free, z14 max, cloudless — natural look',
		attribution: '© EOX • Sentinel-2',
		maxZoom: 14,
	},
	{
		id: 'esri-proxied',
		label: 'ESRI via Tile Proxy',
		url: '/api/tiles/proxy/esri/{z}/{y}/{x}',
		note: 'No CORS on ESRI direct — needs server proxy',
		attribution: '© ESRI',
		maxZoom: 19,
	},
	{
		id: 'osm',
		label: 'OSM Standard (no satellite)',
		url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		note: 'Free map style for comparison',
		attribution: '© OpenStreetMap',
		maxZoom: 19,
	},
	{
		id: 'pmtiles',
		label: 'ESRI PMTiles (local)',
		url: '/pmtiles/esri_dubai.pmtiles',
		note: 'Prefetched offline — needs build-pmtiles',
		isPmtiles: true,
	},
] as const;

/** Look up a source by id in any list, returning a fallback if not found. */
export function findSource(list: readonly ImagerySource[], id: string): ImagerySource {
	return list.find(s => s.id === id) ?? list[0];
}
