/**
 * OSM building extrusions — MapLibre-native layer module.
 *
 * Consumes the existing `/api/buildings/:city` endpoint, which serves a
 * tile-packager-baked GeoJSON FeatureCollection of OSM building polygons
 * with a resolved `height` (meters) property. No Overpass hit at runtime
 * — the packager does that at build time and persists to
 * `${TILE_DIR}/../data/buildings/:city.geojson`.
 *
 * Gotcha: the packaged GeoJSON only guarantees `properties.height`. We
 * still support `properties.levels` and `properties.min_height` as
 * optional inputs because upstream data sources (or a future packager
 * rev) might include them. `fill-extrusion-height` falls back to
 * `levels * 3` and finally a 9 m default so a broken feed still renders.
 *
 * Photometric tint: day = cool grey (#888899), night = amber emissive
 * (#f9b612). Blended by `nightFactor` (0 = noon, 1 = midnight). The
 * emissive strength MapLibre paint property ramps with nightFactor so
 * buildings read as self-lit at night vs reflecting ambient at day.
 *
 * Source + layer IDs are stable constants so the integration site can
 * add/remove cleanly without string duplication.
 */
import type maplibregl from 'maplibre-gl';
import type {
	FillExtrusionLayerSpecification,
	GeoJSONSourceSpecification,
} from 'maplibre-gl';

/** Stable IDs — import these from the integration site if needed. */
export const BUILDINGS_SOURCE_ID = 'playground2-buildings';
export const BUILDINGS_LAYER_ID = 'playground2-buildings-fill';

/**
 * GeoJSON source spec for a city's OSM buildings.
 *
 * @param cityId — LocationId (e.g. 'dubai', 'mumbai'). Must exist in the
 *   LOCATION_MAP; otherwise the endpoint returns 404 and MapLibre will
 *   render an empty layer (harmless).
 */
export function buildingsSource(cityId: string): GeoJSONSourceSpecification {
	return {
		type: 'geojson',
		data: `/api/buildings/${encodeURIComponent(cityId)}`,
		// Buildings are small; no clustering / generateId needed.
	};
}

/**
 * Linear blend of two RGB triples.
 */
function lerpColor(
	dayRgb: [number, number, number],
	nightRgb: [number, number, number],
	t: number,
): string {
	const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
	const r = clamp(dayRgb[0] * (1 - t) + nightRgb[0] * t);
	const g = clamp(dayRgb[1] * (1 - t) + nightRgb[1] * t);
	const b = clamp(dayRgb[2] * (1 - t) + nightRgb[2] * t);
	return `rgb(${r}, ${g}, ${b})`;
}

/**
 * fill-extrusion paint spec that photometrically shifts by nightFactor.
 *
 * @param nightFactor — 0 (full day) → 1 (full night).
 */
export function buildingsLayer(nightFactor: number): FillExtrusionLayerSpecification {
	const t = Math.max(0, Math.min(1, nightFactor));

	// Day = cool neutral grey (reads as concrete + glass under sunlight).
	// Night = Canyon Yellow amber — CIE-correct sodium-lamp hue. Same as
	// the prod Cesium shader (#f9b612). Buildings appear self-lit.
	const dayRgb: [number, number, number] = [0x88, 0x88, 0x99];
	const nightRgb: [number, number, number] = [0xf9, 0xb6, 0x12];
	const color = lerpColor(dayRgb, nightRgb, t);

	return {
		id: BUILDINGS_LAYER_ID,
		type: 'fill-extrusion',
		source: BUILDINGS_SOURCE_ID,
		paint: {
			'fill-extrusion-color': color,
			// Prefer resolved `height`; fall back to `levels * 3`; finally 9 m
			// so a malformed feature still shows as a one-storey box.
			'fill-extrusion-height': [
				'coalesce',
				['get', 'height'],
				['*', ['coalesce', ['get', 'levels'], 3], 3],
				9,
			],
			'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
			'fill-extrusion-opacity': 0.85,
			// Vertical gradient looks natural in daylight (top lit, bottom
			// shadowed); disable at night so emissive amber reads flat+self-lit.
			'fill-extrusion-vertical-gradient': t < 0.5,
			// `emissive-strength` is honoured by MapLibre's 3D style; on
			// older GL builds it's ignored silently. Safe to include.
			'fill-extrusion-emissive-strength': t,
		},
	} as FillExtrusionLayerSpecification;
}

/**
 * Add buildings source + extrusion layer to `map`. Idempotent — calling
 * twice removes the previous instance before re-adding so colour/height
 * updates are safe to re-run on every `nightFactor` change.
 */
export function addBuildings(
	map: maplibregl.Map,
	cityId: string,
	nightFactor: number,
): void {
	removeBuildings(map);
	map.addSource(BUILDINGS_SOURCE_ID, buildingsSource(cityId));
	// Append on top of the style — caller controls z-order by calling
	// this after all basemap layers are added. If a specific insertion
	// point is needed later, pass the beforeId as a 4th arg.
	map.addLayer(buildingsLayer(nightFactor));
}

/**
 * Remove buildings source + layer. No-op if they're not present.
 */
export function removeBuildings(map: maplibregl.Map): void {
	if (map.getLayer(BUILDINGS_LAYER_ID)) map.removeLayer(BUILDINGS_LAYER_ID);
	if (map.getSource(BUILDINGS_SOURCE_ID)) map.removeSource(BUILDINGS_SOURCE_ID);
}
