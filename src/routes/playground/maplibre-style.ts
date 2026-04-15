/**
 * MapLibre style helpers — pure, testable, no DOM/MapLibre runtime needed.
 *
 * Centralizes style construction so MapLibreGlobe stays declarative.
 */

import type maplibregl from 'maplibre-gl';

export const VOYAGER_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

/**
 * Build a self-contained satellite style from a single raster URL.
 * Avoids basemap POIs (no green dots) and provides smooth LOD transitions.
 *
 * - `raster-fade-duration: 0` — no LOD crossfade artifacts on tilted view
 * - `raster-resampling: linear` — soft tile boundaries
 */
export function buildSatelliteStyle(url: string, attribution = '', maxzoom = 14): maplibregl.StyleSpecification {
	return {
		version: 8,
		sources: {
			'sat-imagery': {
				type: 'raster',
				tiles: [url],
				tileSize: 256,
				maxzoom,
				attribution,
			},
		},
		layers: [
			{ id: 'bg', type: 'background', paint: { 'background-color': '#0a1228' } },
			{
				id: 'sat-imagery',
				type: 'raster',
				source: 'sat-imagery',
				paint: {
					'raster-fade-duration': 0,
					'raster-resampling': 'linear',
					'raster-opacity': 1,
				},
			},
		],
		glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
	} as maplibregl.StyleSpecification;
}

/**
 * Convert altitude (feet) to a MapLibre zoom level.
 *
 * Prior formula (16 - log2(alt/30000)) gave z=16 at cruise — EOX max is 14,
 * so tiles at z=17+ all 404'd and the globe rendered black.
 *
 * Tuned curve now: 5000 ft → ~13, 30000 ft → ~10.4, 45000 ft → ~9.8.
 * At high camera pitch (70°+) MapLibre fetches a range around this value,
 * and setSourceTileLodParams caps how many LOD tiers load.
 */
export function altitudeToZoom(altitudeFt: number): number {
	return 13 - Math.log2(altitudeFt / 5000);
}
