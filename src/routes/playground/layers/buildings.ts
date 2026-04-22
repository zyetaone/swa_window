import type maplibregl from 'maplibre-gl';
import { type LocationId } from '$lib/types';

/**
 * addBuildings — injects 3D building extrusions into the MapLibre map.
 * Responsive to location (toggling layers) and time-of-day (night factor).
 */
export function addBuildings(map: maplibregl.Map, _locationId: LocationId, nightFactor: number) {
	if (!map || !map.isStyleLoaded()) return;

	const sourceId = 'openmaptiles';
	const layerId = '3d-buildings';

	// Add/Update the 3D-building extrusion layer
	if (!map.getLayer(layerId)) {
		map.addLayer({
			id: layerId,
			source: sourceId,
			'source-layer': 'building',
			type: 'fill-extrusion',
			minzoom: 12,
			paint: {
				'fill-extrusion-color': [
					'interpolate', ['linear'], ['literal', nightFactor],
					0, '#aaa',   // Day: Light grey
					1, '#222'    // Night: Deep charcoal
				],
				'fill-extrusion-height': ['get', 'render_height'],
				'fill-extrusion-base': ['get', 'render_min_height'],
				'fill-extrusion-opacity': 0.85
			}
		});
	} else {
		// Update night coloring if layer already exists
		map.setPaintProperty(layerId, 'fill-extrusion-color', [
			'interpolate', ['linear'], ['literal', nightFactor],
			0, '#aaa',
			1, '#222'
		]);
	}
}
