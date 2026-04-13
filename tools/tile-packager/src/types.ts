/**
 * Tile Packager Types
 *
 * Shared type definitions for tile coordinate math, bounding boxes,
 * and package manifests.
 */

import type { LocationId } from '../../src/lib/shared/types';

/** A single tile coordinate in the standard XYZ scheme */
export interface TileCoord {
	z: number;
	x: number;
	y: number;
}

/** Geographic bounding box (WGS84 degrees) */
export interface BBox {
	west: number;
	south: number;
	east: number;
	north: number;
}

/** Configuration for a single tile layer */
export interface TileLayerConfig {
	name: string;
	urlTemplate: string;
	minZoom: number;
	maxZoom: number;
	format: 'jpg' | 'png' | 'terrain';
	/** Headers to send with requests (e.g., API tokens) */
	headers?: Record<string, string>;
	/** Whether this layer uses a global tile set (not per-location bbox) */
	global?: boolean;
	/** Rate limit: max requests per second */
	rateLimit?: number;
}

/** Per-location tile specification */
export interface LocationTileSpec {
	locationId: LocationId;
	name: string;
	bbox: BBox;
	layers: TileLayerConfig[];
}

/** Manifest written alongside tile packages */
export interface TileManifest {
	version: string;
	generatedAt: string;
	locations: {
		locationId: LocationId;
		name: string;
		bbox: BBox;
		layers: {
			name: string;
			minZoom: number;
			maxZoom: number;
			tileCount: number;
			sizeBytes: number;
		}[];
		totalTiles: number;
		totalSizeBytes: number;
	}[];
	globalLayers: {
		name: string;
		minZoom: number;
		maxZoom: number;
		tileCount: number;
		sizeBytes: number;
	}[];
	totalSizeBytes: number;
}

/** Download progress callback */
export type ProgressCallback = (layer: string, downloaded: number, total: number) => void;
