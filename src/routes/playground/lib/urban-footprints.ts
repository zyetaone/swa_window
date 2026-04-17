/**
 * Urban footprint GeoJSON — polygon shapes representing the built-up
 * urban extent per location.
 *
 * These polygons act as the MASK in NightMaskLayer's VIIRS composite:
 *   - fill areas = built-up terrain = mask ON (VIIRS light shows through)
 *   - outside polygons = non-urban terrain = mask OFF (VIIRS hidden)
 *
 * Two feature types per location:
 *   - `urban_extent`  — full metropolitan footprint, moderate glow
 *   - `cbd`           — central business district, extra bright glow
 *
 * Coordinate order: [longitude, latitude] (GeoJSON convention).
 * Polygons use winding order [outer ring, hole(s)].
 */

import type { LocationId } from '$lib/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

const fc = (features: GeoJSON.Feature[]) =>
	({ type: 'FeatureCollection' as const, features });

const poly = (
	id: string,
	coords: number[][][],
	props: Record<string, unknown> = {},
): GeoJSON.Feature<GeoJSON.Polygon> => ({
	type: 'Feature',
	id,
	geometry: { type: 'Polygon', coordinates: coords },
	properties: { id, ...props },
});

// ── Dubai ───────────────────────────────────────────────────────────────────

const DUBAI_URBAN = poly('dubai-urban', [[
	[54.7, 25.0], [54.7, 25.4], [55.5, 25.6], [55.8, 25.4],
	[56.0, 25.0], [55.7, 24.9], [55.0, 24.9], [54.7, 25.0],
]], { kind: 'urban_extent', city: 'dubai', glowIntensity: 0.6 });

const DUBAI_CBD = poly('dubai-cbd', [[
	[55.15, 25.12], [55.18, 25.15], [55.28, 25.20], [55.32, 25.18],
	[55.30, 25.12], [55.22, 25.10], [55.15, 25.12],
]], { kind: 'cbd', city: 'dubai', glowIntensity: 1.2 });

const DUBAI_MARINA = poly('dubai-marina', [[
	[55.13, 24.98], [55.15, 25.00], [55.20, 25.02], [55.22, 24.99],
	[55.19, 24.97], [55.14, 24.97], [55.13, 24.98],
]], { kind: 'sub_center', city: 'dubai', glowIntensity: 0.85 });

const DUBAI_DEIRA = poly('dubai-deira', [[
	[55.28, 25.25], [55.32, 25.27], [55.37, 25.28], [55.38, 25.25],
	[55.36, 25.22], [55.30, 25.22], [55.28, 25.25],
]], { kind: 'sub_center', city: 'dubai', glowIntensity: 0.75 });

const DUBAI_JBR = poly('dubai-jbr', [[
	[55.12, 25.07], [55.14, 25.08], [55.18, 25.09], [55.19, 25.07],
	[55.17, 25.06], [55.13, 25.06], [55.12, 25.07],
]], { kind: 'sub_center', city: 'dubai', glowIntensity: 0.7 });

// ── Dallas / Fort Worth ────────────────────────────────────────────────────

const DALLAS_URBAN = poly('dallas-urban', [[
	[-97.1, 32.55], [-97.1, 32.95], [-96.55, 33.05],
	[-96.45, 32.85], [-96.35, 32.75], [-96.55, 32.55],
	[-96.85, 32.50], [-97.1, 32.55],
]], { kind: 'urban_extent', city: 'dallas', glowIntensity: 0.55 });

const DALLAS_CBD = poly('dallas-cbd', [[
	[-96.80, 32.78], [-96.79, 32.79], [-96.77, 32.78],
	[-96.78, 32.77], [-96.80, 32.78],
]], { kind: 'cbd', city: 'dallas', glowIntensity: 1.1 });

const DFW_AIRPORT = poly('dfw-airport', [[
	[-97.08, 32.86], [-97.06, 32.88], [-97.02, 32.90],
	[-97.00, 32.88], [-97.02, 32.85], [-97.06, 32.84],
	[-97.08, 32.86],
]], { kind: 'infra', city: 'dallas', glowIntensity: 0.8 });

// ── Phoenix ─────────────────────────────────────────────────────────────────

const PHOENIX_URBAN = poly('phoenix-urban', [[
	[-112.3, 33.3], [-112.3, 33.65], [-111.75, 33.70],
	[-111.70, 33.55], [-111.72, 33.35], [-112.00, 33.28],
	[-112.30, 33.30],
]], { kind: 'urban_extent', city: 'phoenix', glowIntensity: 0.5 });

const PHOENIX_CBD = poly('phoenix-cbd', [[
	[-112.08, 33.45], [-112.06, 33.46], [-112.04, 33.45],
	[-112.05, 33.43], [-112.08, 33.45],
]], { kind: 'cbd', city: 'phoenix', glowIntensity: 1.0 });

const SKY_HARBOR = poly('phx-airport', [[
	[-112.08, 33.43], [-112.06, 33.44], [-112.04, 33.43],
	[-112.05, 33.42], [-112.08, 33.43],
]], { kind: 'infra', city: 'phoenix', glowIntensity: 0.7 });

// ── Las Vegas ───────────────────────────────────────────────────────────────

const VEGAS_URBAN = poly('vegas-urban', [[
	[-115.35, 35.95], [-115.35, 36.35], [-114.95, 36.40],
	[-114.90, 36.25], [-114.92, 36.00], [-115.20, 35.92],
	[-115.35, 35.95],
]], { kind: 'urban_extent', city: 'las_vegas', glowIntensity: 0.65 });

const VEGAS_STRIP = poly('vegas-strip', [[
	[-115.20, 36.12], [-115.18, 36.13], [-115.15, 36.12],
	[-115.16, 36.10], [-115.20, 36.12],
]], { kind: 'cbd', city: 'las_vegas', glowIntensity: 1.4 });

const VEGAS_DOWNTOWN = poly('vegas-downtown', [[
	[-115.14, 36.17], [-115.13, 36.18], [-115.11, 36.17],
	[-115.12, 36.16], [-115.14, 36.17],
]], { kind: 'sub_center', city: 'las_vegas', glowIntensity: 0.9 });

// ── Denver ──────────────────────────────────────────────────────────────────

const DENVER_URBAN = poly('denver-urban', [[
	[-105.15, 39.55], [-105.15, 39.85], [-104.65, 39.90],
	[-104.60, 39.75], [-104.65, 39.55], [-104.95, 39.52],
	[-105.15, 39.55],
]], { kind: 'urban_extent', city: 'denver', glowIntensity: 0.55 });

const DENVER_CBD = poly('denver-cbd', [[
	[-104.995, 39.748], [-104.990, 39.752], [-104.985, 39.748],
	[-104.988, 39.745], [-104.995, 39.748],
]], { kind: 'cbd', city: 'denver', glowIntensity: 1.1 });

// ── Chicago Midway ──────────────────────────────────────────────────────────

const CHICAGO_URBAN = poly('chicago-urban', [[
	[-87.90, 41.65], [-87.90, 42.05], [-87.50, 42.10],
	[-87.45, 41.88], [-87.55, 41.70], [-87.78, 41.65],
	[-87.90, 41.65],
]], { kind: 'urban_extent', city: 'chicago_midway', glowIntensity: 0.5 });

const CHICAGO_CBD = poly('chicago-cbd', [[
	[-87.64, 41.88], [-87.63, 41.89], [-87.62, 41.88],
	[-87.63, 41.87], [-87.64, 41.88],
]], { kind: 'cbd', city: 'chicago_midway', glowIntensity: 1.0 });

const MIDWAY_AIRPORT = poly('midway-airport', [[
	[-87.76, 41.79], [-87.74, 41.80], [-87.73, 41.79],
	[-87.75, 41.78], [-87.76, 41.79],
]], { kind: 'infra', city: 'chicago_midway', glowIntensity: 0.75 });

// ── Mumbai ──────────────────────────────────────────────────────────────────

const MUMBAI_URBAN = poly('mumbai-urban', [[
	[72.75, 18.85], [72.75, 19.25], [73.10, 19.30],
	[73.20, 19.10], [73.15, 18.90], [72.85, 18.80],
	[72.75, 18.85],
]], { kind: 'urban_extent', city: 'mumbai', glowIntensity: 0.6 });

const MUMBAI_CBD = poly('mumbai-cbd', [[
	[72.83, 18.94], [72.85, 18.95], [72.88, 18.94],
	[72.87, 18.92], [72.83, 18.94],
]], { kind: 'cbd', city: 'mumbai', glowIntensity: 1.2 });

const MUMBAI_AIRPORT = poly('mumbai-airport', [[
	[72.86, 19.09], [72.87, 19.10], [72.88, 19.09],
	[72.87, 19.08], [72.86, 19.09],
]], { kind: 'infra', city: 'mumbai', glowIntensity: 0.8 });

// ── Hyderabad ────────────────────────────────────────────────────────────────

const HYDERABAD_URBAN = poly('hyderabad-urban', [[
	[78.30, 17.30], [78.30, 17.55], [78.60, 17.60],
	[78.65, 17.40], [78.60, 17.25], [78.35, 17.20],
	[78.30, 17.30],
]], { kind: 'urban_extent', city: 'hyderabad', glowIntensity: 0.55 });

const HYDERABAD_CBD = poly('hyderabad-cbd', [[
	[78.47, 17.43], [78.48, 17.44], [78.50, 17.43],
	[78.49, 17.42], [78.47, 17.43],
]], { kind: 'cbd', city: 'hyderabad', glowIntensity: 1.1 });

// ── Himalayas ────────────────────────────────────────────────────────────────

const HIMALAYAS_REGION = poly('himalayas-region', [[
	[86.0, 27.5], [86.0, 28.5], [88.0, 28.5],
	[88.0, 27.5], [86.0, 27.5],
]], { kind: 'mountain_region', city: 'himalayas', glowIntensity: 0.05 });

// ── Ocean ────────────────────────────────────────────────────────────────────

// No urban footprint — ocean stays dark
const OCEAN_FAKE = poly('ocean-marker', [[
	[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001],
]], { kind: 'ocean', city: 'ocean', glowIntensity: 0 });

// ── Desert ──────────────────────────────────────────────────────────────────

// No urban footprint — desert stays dark
const DESERT_FAKE = poly('desert-marker', [[
	[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001],
]], { kind: 'desert', city: 'desert', glowIntensity: 0 });

// ── All locations ────────────────────────────────────────────────────────────

export const URBAN_FOOTPRINTS: Record<LocationId, GeoJSON.FeatureCollection> = {
	dubai: fc([DUBAI_URBAN, DUBAI_CBD, DUBAI_MARINA, DUBAI_DEIRA, DUBAI_JBR]),
	dallas: fc([DALLAS_URBAN, DALLAS_CBD, DFW_AIRPORT]),
	phoenix: fc([PHOENIX_URBAN, PHOENIX_CBD, SKY_HARBOR]),
	las_vegas: fc([VEGAS_URBAN, VEGAS_STRIP, VEGAS_DOWNTOWN]),
	denver: fc([DENVER_URBAN, DENVER_CBD]),
	chicago_midway: fc([CHICAGO_URBAN, CHICAGO_CBD, MIDWAY_AIRPORT]),
	mumbai: fc([MUMBAI_URBAN, MUMBAI_CBD, MUMBAI_AIRPORT]),
	hyderabad: fc([HYDERABAD_URBAN, HYDERABAD_CBD]),
	himalayas: fc([HIMALAYAS_REGION]),
	ocean: fc([OCEAN_FAKE]),
	desert: fc([DESERT_FAKE]),
	clouds: fc([OCEAN_FAKE]),
};

export function footprintsFor(locationId: LocationId): GeoJSON.FeatureCollection {
	return URBAN_FOOTPRINTS[locationId] ?? URBAN_FOOTPRINTS.dubai;
}

// ── Feature type helpers ─────────────────────────────────────────────────────

export type FootprintKind = 'urban_extent' | 'cbd' | 'sub_center' | 'infra' | 'mountain_region' | 'ocean' | 'desert';

export function isBuiltUp(kind: FootprintKind): boolean {
	return kind !== 'mountain_region' && kind !== 'ocean' && kind !== 'desert';
}

export function glowMultiplier(kind: FootprintKind): number {
	switch (kind) {
		case 'cbd': return 1.5;
		case 'sub_center': return 1.0;
		case 'infra': return 0.9;
		case 'urban_extent': return 0.6;
		default: return 0;
	}
}