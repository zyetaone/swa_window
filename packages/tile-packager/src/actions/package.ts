/**
 * Package Action — orchestrates tile downloading for all layers and locations,
 * writes manifest.json alongside the tile directory.
 */

import type { LocationTileSpec, TileManifest, ProgressCallback } from '../types';
import { tilesForBBoxRange, countTilesInBBox } from '../rules';
import { fetchTiles } from './fetcher';

/**
 * Download all tiles for a location spec into the output directory.
 * Returns per-layer stats for the manifest.
 */
async function downloadLocationTiles(
	spec: LocationTileSpec,
	outputDir: string,
	onProgress?: ProgressCallback,
): Promise<TileManifest['locations'][0]> {
	const layerStats: TileManifest['locations'][0]['layers'] = [];
	let totalTiles = 0;
	let totalSize = 0;

	for (const layer of spec.layers) {
		if (layer.global) continue; // Global layers handled separately

		const tiles = tilesForBBoxRange(spec.bbox, layer.minZoom, layer.maxZoom);
		console.log(`  [${spec.name}/${layer.name}] Downloading ${tiles.length} tiles (z${layer.minZoom}-${layer.maxZoom})...`);

		const result = await fetchTiles(layer, tiles, outputDir, onProgress);
		console.log(`  [${spec.name}/${layer.name}] Done: ${result.downloaded} new, ${result.skipped} skipped, ${result.failed} failed (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);

		layerStats.push({
			name: layer.name,
			minZoom: layer.minZoom,
			maxZoom: layer.maxZoom,
			tileCount: result.downloaded + result.skipped,
			sizeBytes: result.bytes,
		});

		totalTiles += result.downloaded + result.skipped;
		totalSize += result.bytes;
	}

	return {
		locationId: spec.locationId,
		name: spec.name,
		bbox: spec.bbox,
		layers: layerStats,
		totalTiles,
		totalSizeBytes: totalSize,
	};
}

/**
 * Download global tile layers (e.g., NASA VIIRS — shared across all locations).
 */
async function downloadGlobalTiles(
	specs: LocationTileSpec[],
	outputDir: string,
	onProgress?: ProgressCallback,
): Promise<TileManifest['globalLayers']> {
	const globalLayers: TileManifest['globalLayers'] = [];

	// Collect unique global layers from all specs
	const seen = new Set<string>();
	for (const spec of specs) {
		for (const layer of spec.layers) {
			if (layer.global && !seen.has(layer.name)) {
				seen.add(layer.name);

				// For global layers, download a broader bbox covering all locations
				const allLats = specs.map(s => s.bbox.south).concat(specs.map(s => s.bbox.north));
				const allLons = specs.map(s => s.bbox.west).concat(specs.map(s => s.bbox.east));
				const globalBbox = {
					west: Math.min(...allLons) - 5,
					south: Math.min(...allLats) - 5,
					east: Math.max(...allLons) + 5,
					north: Math.max(...allLats) + 5,
				};

				const tiles = tilesForBBoxRange(globalBbox, layer.minZoom, layer.maxZoom);
				console.log(`  [global/${layer.name}] Downloading ${tiles.length} tiles (z${layer.minZoom}-${layer.maxZoom})...`);

				const result = await fetchTiles(layer, tiles, outputDir, onProgress);
				console.log(`  [global/${layer.name}] Done: ${result.downloaded} new, ${result.skipped} skipped, ${result.failed} failed (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`);

				globalLayers.push({
					name: layer.name,
					minZoom: layer.minZoom,
					maxZoom: layer.maxZoom,
					tileCount: result.downloaded + result.skipped,
					sizeBytes: result.bytes,
				});
			}
		}
	}

	return globalLayers;
}

/**
 * Main packaging function — downloads all tiles and writes manifest.
 */
export async function packageTiles(
	specs: LocationTileSpec[],
	outputDir: string,
	onProgress?: ProgressCallback,
): Promise<TileManifest> {
	console.log(`\nPackaging tiles for ${specs.length} locations into ${outputDir}\n`);

	// Estimate
	let totalEstimate = 0;
	for (const spec of specs) {
		for (const layer of spec.layers) {
			if (!layer.global) {
				totalEstimate += countTilesInBBox(spec.bbox, layer.minZoom, layer.maxZoom);
			}
		}
	}
	console.log(`Estimated total: ~${totalEstimate.toLocaleString()} tiles\n`);

	// Download global layers first
	console.log('=== Global Layers ===');
	const globalLayers = await downloadGlobalTiles(specs, outputDir, onProgress);

	// Download per-location layers
	const locationStats: TileManifest['locations'] = [];
	for (const spec of specs) {
		console.log(`\n=== ${spec.name} (${spec.locationId}) ===`);
		const stats = await downloadLocationTiles(spec, outputDir, onProgress);
		locationStats.push(stats);
	}

	const totalSizeBytes = locationStats.reduce((s, l) => s + l.totalSizeBytes, 0)
		+ globalLayers.reduce((s, l) => s + l.sizeBytes, 0);

	const manifest: TileManifest = {
		version: '1.0.0',
		generatedAt: new Date().toISOString(),
		locations: locationStats,
		globalLayers,
		totalSizeBytes,
	};

	// Write manifest
	const manifestPath = `${outputDir}/manifest.json`;
	await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
	console.log(`\nManifest written to ${manifestPath}`);
	console.log(`Total size: ${(totalSizeBytes / 1024 / 1024).toFixed(1)} MB`);

	return manifest;
}
