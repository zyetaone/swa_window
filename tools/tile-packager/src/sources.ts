/**
 * Per-source URL templates + zoom ranges for the tile packager.
 *
 * Mirrors what CesiumManager would request at runtime, but pre-warms
 * a local cache so the Pi can serve tiles offline via /api/tiles/[...path].
 */

import type { TileSource, TileSpec } from './rules';

export interface SourceConfig {
	source: TileSource;
	/** Filename template — {z}, {x}, {y} substituted. Determines on-disk path. */
	storagePath: string;
	urlForTile(t: TileSpec): string;
	zoomRange: [number, number];
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
		storagePath: 'cartodb-dark/{z}/{x}/{y}@2x.png',
		urlForTile: (t) => `https://basemaps.cartocdn.com/dark_all/${t.z}/${t.x}/${t.y}@2x.png`,
		zoomRange: [4, 12],
	},
	'viirs-night-lights': {
		source: 'viirs-night-lights',
		storagePath: 'viirs-night-lights/{z}/{y}/{x}.jpg',
		urlForTile: (t) =>
			`https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/2016-01-01/GoogleMapsCompatible_Level8/${t.z}/${t.y}/${t.x}.jpg`,
		zoomRange: [3, 8], // VIIRS only available up to z8
	},
};

export function tileFilePath(cfg: SourceConfig, t: TileSpec): string {
	return cfg.storagePath
		.replaceAll('{z}', String(t.z))
		.replaceAll('{x}', String(t.x))
		.replaceAll('{y}', String(t.y));
}
