/**
 * Per-source URL templates + zoom ranges for the tile packager.
 *
 * Mirrors what CesiumManager would request at runtime, but pre-warms
 * a local cache so the Pi can serve tiles offline via /api/tiles/[...path].
 *
 * Types:
 *   - TileSource     → XYZ tile grid, downloaded per enumerated (z,x,y)
 *   - NonTileSource  → per-location artifact (e.g. Overpass GeoJSON)
 */

import type { TileSource, TileSpec } from './rules';

// ─── Standard XYZ tile sources ──────────────────────────────────────────────

export interface SourceConfig {
	source: TileSource;
	/** Filename template — {z}, {x}, {y} substituted. Determines on-disk path. */
	storagePath: string;
	urlForTile(t: TileSpec): string;
	zoomRange: [number, number];
	prepareHeaders?: () => Promise<Record<string, string>>;
	/** Apply brightness/contrast boost after download (for dim VIIRS tiles). */
	postProcess?: boolean;
	boostBrightness?: number;
	boostContrast?: number;
}

export const SOURCES: Record<TileSource, SourceConfig> = {
	'eox-sentinel2': {
		source: 'eox-sentinel2',
		storagePath: 'eox-sentinel2/{z}/{y}/{x}.jpg',
		urlForTile: (t) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/${t.z}/${t.y}/${t.x}.jpg`,
		zoomRange: [4, 12], // EOX caps at z14; we stop at z12 to keep storage sane
	},
	'esri-world-imagery': {
		source: 'esri-world-imagery',
		storagePath: 'esri-world-imagery/{z}/{y}/{x}.jpg',
		urlForTile: (t) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`,
		zoomRange: [4, 14],
	},
	'cartodb-dark': {
		source: 'cartodb-dark',
		// Uses dark_nolabels — no place-name overlay over the city-light glow.
		storagePath: 'cartodb-dark/{z}/{x}/{y}@2x.png',
		urlForTile: (t) => `https://basemaps.cartocdn.com/dark_nolabels/${t.z}/${t.x}/${t.y}@2x.png`,
		zoomRange: [4, 12],
	},
	'viirs-night-lights': {
		source: 'viirs-night-lights',
		storagePath: 'viirs-night-lights/{z}/{y}/{x}.jpg',
		// Layer + pinned date MUST match src/lib/world/viirs-endpoint.ts — the
		// packaged tiles and the remote fallback have to be the same raster, or
		// a cache miss silently changes what the city looks like. See that file
		// for why Black Marble was dropped (colorized, lifted navy background
		// that cleared the "truly dark" floor over ocean and desert).
		urlForTile: (t) =>
			`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance/default/2026-07-15/GoogleMapsCompatible_Level8/${t.z}/${t.y}/${t.x}.png`,
		zoomRange: [3, 8], // every GIBS night layer is capped at z8
		// Boost halved (5.0 → 2.5). The old ×5 existed because Black Marble read
		// ~15/255 over Indian cities; this radiance product reads a median 77/255
		// over Hyderabad, so the old gain would clip the core to white and drag
		// the background grain up with it.
		postProcess: true,
		boostBrightness: 2.5,
		boostContrast: 1.5,
	},
	/**
	 * Cesium Ion World Terrain (asset 1) — quantized-mesh tiles.
	 * Lazy-initialised at build time via IonEndpoint: a one-off GET to
	 * api.cesium.com/v1/assets/1/endpoint returns `{url, accessToken}` valid
	 * for the packager run. Tiles then fetched with Authorization header.
	 *
	 * Requires CESIUM_ION_TOKEN env var at build time. Zero runtime cost
	 * once cached — the fielded Pi ships without the token, just serves
	 * the .terrain files from /api/tiles/cesium-terrain/.
	 */
	'cesium-terrain': {
		source: 'cesium-terrain',
		storagePath: 'cesium-terrain/{z}/{x}/{y}.terrain',
		urlForTile: (t) => {
			const base = ionEndpointCache?.url ?? '';
			return `${base.replace(/\/$/, '')}/${t.z}/${t.x}/${t.y}.terrain`;
		},
		prepareHeaders: async () => {
			const endpoint = await getIonEndpoint();
			return { Authorization: `Bearer ${endpoint.accessToken}` };
		},
		zoomRange: [4, 12],
	},
};

export function tileFilePath(cfg: SourceConfig, t: TileSpec): string {
	return cfg.storagePath
		.replaceAll('{z}', String(t.z))
		.replaceAll('{x}', String(t.x))
		.replaceAll('{y}', String(t.y));
}

// ─── Cesium Ion endpoint handshake (private) ────────────────────────────────

interface IonEndpoint {
	url: string;
	accessToken: string;
	fetchedAt: number; // epoch ms — tokens are short-lived; refetch if stale
}

let ionEndpointCache: IonEndpoint | null = null;
const ION_ENDPOINT_TTL_MS = 3_600_000; // 1 hour

async function getIonEndpoint(): Promise<IonEndpoint> {
	const now = Date.now();
	if (ionEndpointCache && now - ionEndpointCache.fetchedAt < ION_ENDPOINT_TTL_MS) {
		return ionEndpointCache;
	}
	const token = process.env.CESIUM_ION_TOKEN;
	if (!token) {
		throw new Error(
			'CESIUM_ION_TOKEN env var is required to fetch cesium-terrain tiles. ' +
				'Set it for the build, or exclude cesium-terrain via --sources.',
		);
	}
	const res = await fetch(`https://api.cesium.com/v1/assets/1/endpoint?access_token=${token}`);
	if (!res.ok) {
		throw new Error(`Ion endpoint handshake failed: ${res.status} ${res.statusText}`);
	}
	const data = (await res.json()) as { url: string; accessToken: string };
	ionEndpointCache = { url: data.url, accessToken: data.accessToken, fetchedAt: now };
	return ionEndpointCache;
}

/**
 * Fetch layer.json metadata for the Cesium terrain asset once per run and
 * save it alongside the tile tree so the runtime provider can read it.
 */
export async function fetchIonLayerJson(): Promise<Uint8Array> {
	const endpoint = await getIonEndpoint();
	const res = await fetch(`${endpoint.url.replace(/\/$/, '')}/layer.json`, {
		headers: { Authorization: `Bearer ${endpoint.accessToken}` },
	});
	if (!res.ok) {
		throw new Error(`Ion layer.json fetch failed: ${res.status} ${res.statusText}`);
	}
	return new Uint8Array(await res.arrayBuffer());
}

// ─── OSM Buildings via Overpass (per-location GeoJSON) ──────────────────────

export interface BuildingsConfig {
	/** Relative output path for the GeoJSON artifact. */
	storagePath: (city: string) => string;
	/** Overpass query template — {lat}, {lon}, {radius} substituted. */
	buildOverpassQuery: (lat: number, lon: number, radiusMeters: number) => string;
	/** Default radius around each location to fetch building footprints (meters). */
	defaultRadiusMeters: number;
	/** Endpoint to POST the Overpass query. Public mirrors rotate; pick the first that works. */
	endpoints: readonly string[];
}

export const BUILDINGS_CONFIG: BuildingsConfig = {
	storagePath: (city) => `../data/buildings/${city}.geojson`,
	// Asks Overpass for all building ways within a radius, returns geometry inline
	// so we don't need a second pass to resolve nodes.
	buildOverpassQuery: (lat, lon, radius) =>
		`[out:json][timeout:90];` +
		`(way["building"](around:${radius},${lat},${lon}););` +
		`out geom tags;`,
	defaultRadiusMeters: 3_500, // ~7 km square — comfortably covers cruise-altitude visible cone
	endpoints: [
		'https://overpass-api.de/api/interpreter',
		'https://overpass.kumi.systems/api/interpreter',
		'https://overpass.private.coffee/api/interpreter',
	] as const,
};

/**
 * Convert an Overpass `way[building]` response into a slim extrusion-ready
 * GeoJSON FeatureCollection. Keeps only the fields Cesium / Maplibre need
 * to extrude polygons: coordinates + height estimate.
 *
 * Height heuristic when `height`/`building:levels` are absent: 3 m per floor,
 * default 3 floors (9 m) — matches typical OSM extrusion defaults.
 */
export function overpassToGeoJson(overpassJson: {
	elements: Array<{
		type: string;
		geometry?: Array<{ lat: number; lon: number }>;
		tags?: Record<string, string>;
	}>;
}): {
	type: 'FeatureCollection';
	features: Array<{
		type: 'Feature';
		properties: { height: number; name?: string };
		geometry: { type: 'Polygon'; coordinates: number[][][] };
	}>;
} {
	const features: Array<{
		type: 'Feature';
		properties: { height: number; name?: string };
		geometry: { type: 'Polygon'; coordinates: number[][][] };
	}> = [];
	for (const el of overpassJson.elements) {
		if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue;
		const ring = el.geometry.map((g) => [g.lon, g.lat]);
		// Ensure closed ring
		const first = ring[0];
		const last = ring[ring.length - 1];
		if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

		const tags = el.tags ?? {};
		const rawHeight = tags['height'];
		const rawLevels = tags['building:levels'];
		let height = 9;
		if (rawHeight && !Number.isNaN(Number.parseFloat(rawHeight))) {
			height = Number.parseFloat(rawHeight);
		} else if (rawLevels && !Number.isNaN(Number.parseInt(rawLevels, 10))) {
			height = Number.parseInt(rawLevels, 10) * 3;
		}

		features.push({
			type: 'Feature',
			properties: {
				height,
				...(tags.name ? { name: tags.name } : {}),
			},
			geometry: { type: 'Polygon', coordinates: [ring] },
		});
	}
	return { type: 'FeatureCollection', features };
}
