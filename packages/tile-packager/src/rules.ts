/**
 * Tile Packager Rules
 *
 * Pure functions for bounding box calculation, tile coordinate enumeration,
 * and zoom range selection. No I/O, no side effects — fully testable.
 */

import { LOCATIONS, AIRCRAFT } from '@zyeta/shared';
import type { LocationId } from '@zyeta/shared';
import type { BBox, TileCoord, TileLayerConfig, LocationTileSpec } from './types';

// ============================================================================
// BOUNDING BOX
// ============================================================================

/** Degrees of longitude per km at a given latitude */
function lonDegreesPerKm(lat: number): number {
	return 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
}

/** Degrees of latitude per km (approximately constant) */
const LAT_DEGREES_PER_KM = 1 / 110.574;

/**
 * Compute a bounding box around a location, sized to cover the orbit path
 * plus camera viewport at cruise altitude.
 *
 * At 35,000 ft with ~60° FOV, the visible ground extends ~80km forward.
 * Orbit radius is ~0.25° ≈ 28km. Combined with padding: ~1.5° × 1.2°.
 */
export function bboxForLocation(
	lat: number,
	lon: number,
	radiusKm: number = 80,
): BBox {
	const latPad = radiusKm * LAT_DEGREES_PER_KM;
	const lonPad = radiusKm * lonDegreesPerKm(lat);
	return {
		west: lon - lonPad,
		south: lat - latPad,
		east: lon + lonPad,
		north: lat + latPad,
	};
}

// ============================================================================
// TILE COORDINATES
// ============================================================================

/** Convert lat/lon to tile coordinates at a given zoom level */
export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
	const n = Math.pow(2, z);
	const x = Math.floor(((lon + 180) / 360) * n);
	const latRad = (lat * Math.PI) / 180;
	const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
	return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Enumerate all tile coordinates within a bounding box at a given zoom level */
export function tilesInBBox(bbox: BBox, z: number): TileCoord[] {
	const topLeft = latLonToTile(bbox.north, bbox.west, z);
	const bottomRight = latLonToTile(bbox.south, bbox.east, z);

	const tiles: TileCoord[] = [];
	for (let x = topLeft.x; x <= bottomRight.x; x++) {
		for (let y = topLeft.y; y <= bottomRight.y; y++) {
			tiles.push({ z, x, y });
		}
	}
	return tiles;
}

/** Enumerate all tiles for a bbox across a zoom range */
export function tilesForBBoxRange(bbox: BBox, minZoom: number, maxZoom: number): TileCoord[] {
	const all: TileCoord[] = [];
	for (let z = minZoom; z <= maxZoom; z++) {
		all.push(...tilesInBBox(bbox, z));
	}
	return all;
}

/** Count tiles without allocating the array */
export function countTilesInBBox(bbox: BBox, minZoom: number, maxZoom: number): number {
	let count = 0;
	for (let z = minZoom; z <= maxZoom; z++) {
		const topLeft = latLonToTile(bbox.north, bbox.west, z);
		const bottomRight = latLonToTile(bbox.south, bbox.east, z);
		count += (bottomRight.x - topLeft.x + 1) * (bottomRight.y - topLeft.y + 1);
	}
	return count;
}

// ============================================================================
// ZOOM RANGES (altitude-driven)
// ============================================================================

/**
 * Determine the useful zoom range for imagery at a given altitude range.
 * At cruise altitude (28k-48k ft), tiles above z13 are wasted (sub-pixel detail).
 */
export function imageryZoomRange(minAltitude: number, maxAltitude: number): { min: number; max: number } {
	// At 48k ft → z8-9 is sufficient; at 10k ft → z14 needed
	const maxZoom = Math.min(14, Math.max(8, Math.round(18 - Math.log2(maxAltitude / 1000))));
	const minZoom = Math.max(0, maxZoom - 6);
	return { min: minZoom, max: maxZoom };
}

/** Terrain needs fewer zoom levels than imagery (meshes are lower-res) */
export function terrainZoomRange(): { min: number; max: number } {
	return { min: 0, max: 12 };
}

// ============================================================================
// LAYER CONFIGS
// ============================================================================

const ESRI_IMAGERY: TileLayerConfig = {
	name: 'imagery',
	urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
	minZoom: 0,
	maxZoom: 14,
	format: 'jpg',
	rateLimit: 50,
};

const NASA_VIIRS: TileLayerConfig = {
	name: 'viirs',
	urlTemplate: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg',
	minZoom: 0,
	maxZoom: 8,
	format: 'jpg',
	global: true,
	rateLimit: 20,
};

const CARTO_DARK: TileLayerConfig = {
	name: 'roads',
	urlTemplate: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
	minZoom: 0,
	maxZoom: 14,
	format: 'png',
	rateLimit: 50,
};

export const DEFAULT_LAYERS: TileLayerConfig[] = [ESRI_IMAGERY, NASA_VIIRS, CARTO_DARK];

// ============================================================================
// LOCATION SPEC GENERATION
// ============================================================================

/**
 * Generate tile specs for all (or selected) locations.
 * This is the main entry point for the packager rules layer.
 */
export function generateTileSpecs(locationIds?: LocationId[]): LocationTileSpec[] {
	const locs = locationIds
		? LOCATIONS.filter(l => locationIds.includes(l.id))
		: LOCATIONS;

	return locs.map(loc => {
		const bbox = bboxForLocation(loc.lat, loc.lon);
		const minAlt = Math.min(loc.defaultAltitude, loc.nightAltitude);
		const { max: imgMaxZoom } = imageryZoomRange(minAlt, loc.defaultAltitude);

		const layers = DEFAULT_LAYERS.map(layer => ({
			...layer,
			maxZoom: layer.global ? layer.maxZoom : Math.min(layer.maxZoom, imgMaxZoom),
		}));

		return { locationId: loc.id, name: loc.name, bbox, layers };
	});
}

/**
 * Estimate total storage for a set of tile specs.
 * Average tile sizes: ESRI JPEG ~20KB, CartoDB PNG ~8KB, VIIRS JPEG ~15KB.
 */
export function estimateStorage(specs: LocationTileSpec[]): {
	perLocation: Map<string, { tiles: number; bytes: number }>;
	global: { tiles: number; bytes: number };
	total: { tiles: number; bytes: number };
} {
	const AVG_SIZES: Record<string, number> = {
		imagery: 20_000,
		roads: 8_000,
		viirs: 15_000,
		terrain: 30_000,
	};

	const perLocation = new Map<string, { tiles: number; bytes: number }>();
	let globalTiles = 0;
	let globalBytes = 0;
	let totalTiles = 0;
	let totalBytes = 0;

	for (const spec of specs) {
		let locTiles = 0;
		let locBytes = 0;

		for (const layer of spec.layers) {
			const avgSize = AVG_SIZES[layer.name] ?? 15_000;
			if (layer.global) {
				// Count global layers once
				const count = countTilesInBBox(
					{ west: -180, south: -85, east: 180, north: 85 },
					layer.minZoom,
					layer.maxZoom,
				);
				globalTiles = count;
				globalBytes = count * avgSize;
			} else {
				const count = countTilesInBBox(spec.bbox, layer.minZoom, layer.maxZoom);
				locTiles += count;
				locBytes += count * avgSize;
			}
		}

		perLocation.set(spec.locationId, { tiles: locTiles, bytes: locBytes });
		totalTiles += locTiles;
		totalBytes += locBytes;
	}

	totalTiles += globalTiles;
	totalBytes += globalBytes;

	return {
		perLocation,
		global: { tiles: globalTiles, bytes: globalBytes },
		total: { tiles: totalTiles, bytes: totalBytes },
	};
}
