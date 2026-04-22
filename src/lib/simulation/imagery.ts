/**
 * Imagery sources for the MapLibre simulation.
 *
 * MapLibre requires CORS-enabled tile endpoints (WebGL texture use is tainted
 * otherwise). Sources listed here all pass CORS, either directly or via the
 * local /api/tiles proxy.
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
 * Online MapLibre tile sources. All CORS-safe at time of commit.
 * The /api/tiles/proxy/esri endpoint is a server-side pass-through
 * because ESRI World Imagery lacks CORS headers directly.
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

/**
 * Cached (offline) tile sources served from the local tile API.
 * Pre-downloaded via `bun run tile-packager` for the active locations.
 */
export const CACHED_SOURCES: readonly ImagerySource[] = [
	{
		id: 'cached-eox',
		label: '🗄️ Cached — Sentinel-2',
		url: '/api/tiles/xyz/eox-sentinel2/{z}/{x}/{y}.jpg',
		note: 'Offline • dubai/dallas/himalayas • z4-12',
		attribution: '© EOX • Sentinel-2',
		maxZoom: 12,
	},
	{
		id: 'cached-esri',
		label: '🗄️ Cached — ESRI Satellite',
		url: '/api/tiles/xyz/esri-world-imagery/{z}/{x}/{y}.jpg',
		note: 'Offline • dubai/dallas/himalayas • z4-14',
		attribution: '© ESRI',
		maxZoom: 14,
	},
	{
		id: 'cached-cartodb',
		label: '🗄️ Cached — CartoDB Dark',
		url: '/api/tiles/xyz/cartodb-dark/{z}/{x}/{y}@2x.png',
		note: 'Offline • dubai/dallas/himalayas • z4-12',
		attribution: '© CartoDB',
		maxZoom: 12,
	},
	{
		id: 'cached-viirs',
		label: '🗄️ Cached — VIIRS Night Lights',
		url: '/api/tiles/xyz/viirs-night-lights/{z}/{x}/{y}.jpg',
		note: 'Offline • dubai/dallas/himalayas • z3-8',
		attribution: '© NASA VIIRS',
		maxZoom: 8,
	},
] as const;

/** Look up a source by id in any list, returning a fallback if not found. */
export function findSource(list: readonly ImagerySource[], id: string): ImagerySource {
	return list.find(s => s.id === id) ?? list[0];
}

/** All MapLibre sources including cached offline tiles. */
export const ALL_MAPLIBRE_SOURCES: readonly ImagerySource[] = [
	...MAPLIBRE_SOURCES,
	...CACHED_SOURCES,
];
