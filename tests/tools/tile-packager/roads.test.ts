/**
 * The road extractor `data/roads/` never had.
 *
 * The shipped extracts had NO generator in the repo — the only road-shaped code
 * in the packager was the CARTO raster compositor. That is how the data ended
 * up at a radius nobody chose: denver at 4.2 x 2.3 km / 128 features, against a
 * ~100 km visible ground at the night band.
 *
 * These cover the parts that are easy to get wrong and invisible in a diff: the
 * per-class radius design, cross-query deduplication, and the slimming that
 * decides whether this rides `git pull` to the fleet or not.
 */
import { describe, it, expect } from 'vitest';
import {
	ROAD_CLASSES,
	ROAD_RADIUS_M,
	ROADS_CONFIG,
	radiusGroups,
	normaliseClass,
	overpassToRoadGeoJson,
} from '../../../tools/tile-packager/src/roads';

const way = (id: number, highway: string, geometry: Array<[number, number]>) => ({
	type: 'way',
	id,
	tags: { highway },
	geometry: geometry.map(([lon, lat]) => ({ lon, lat })),
});

describe('radius is tiered by class, not uniform', () => {
	it('gives arterials a far wider reach than side streets', () => {
		// THE design. A uniform radius either postage-stamps the frame (small) or
		// pays quadratically for residential geometry that altitudeDetailMix
		// fades to nothing at cruise (large).
		expect(ROAD_RADIUS_M.motorway).toBeGreaterThan(ROAD_RADIUS_M.residential * 4);
		expect(ROAD_RADIUS_M.primary).toBeGreaterThan(ROAD_RADIUS_M.secondary);
		expect(ROAD_RADIUS_M.secondary).toBeGreaterThan(ROAD_RADIUS_M.residential);
	});

	it('reaches far enough for arterials to survive the night band', () => {
		// The failure being prevented: an extract smaller than the visible ground,
		// which reads as a bright island rather than as a city.
		expect(ROAD_RADIUS_M.motorway).toBeGreaterThanOrEqual(30_000);
	});

	it('covers every class the renderer styles', () => {
		for (const c of ROAD_CLASSES) {
			expect(ROAD_RADIUS_M[c], c).toBeGreaterThan(0);
		}
	});

	it('groups classes so there is one query per radius, not one per class', () => {
		// Six queries per city against public Overpass mirrors would be rude and
		// slow; the radii collapse to a handful of groups.
		const groups = radiusGroups();
		expect(groups.length).toBeLessThan(ROAD_CLASSES.length);
		expect(groups.flatMap((g) => g.classes).sort()).toEqual([...ROAD_CLASSES].sort());
	});

	it('queries widest-first so the dedup set fills with arterials first', () => {
		const radii = radiusGroups().map((g) => g.radius);
		expect(radii).toEqual([...radii].sort((a, b) => b - a));
	});
});

describe('the Overpass query asks for what the renderer draws', () => {
	it('includes link roads so interchanges read as interchanges', () => {
		const q = ROADS_CONFIG.buildOverpassQuery(17.4, 78.4, 40_000, ['motorway']);
		expect(q).toContain('_link');
	});

	it('pins the radius and centre it was given', () => {
		const q = ROADS_CONFIG.buildOverpassQuery(17.4435, 78.3772, 12_000, ['secondary']);
		expect(q).toContain('around:12000,17.4435,78.3772');
	});

	it('returns geometry inline, so no second node-resolution pass is needed', () => {
		expect(ROADS_CONFIG.buildOverpassQuery(0, 0, 1, ['primary'])).toContain('out geom');
	});
});

describe('class normalisation', () => {
	it('styles link roads as their parent class', () => {
		expect(normaliseClass('motorway_link')).toBe('motorway');
		expect(normaliseClass('primary_link')).toBe('primary');
	});

	it('keeps the classes the renderer knows', () => {
		for (const c of ROAD_CLASSES) expect(normaliseClass(c)).toBe(c);
	});

	it('drops everything else rather than mislabelling it', () => {
		// A footpath or driveway styled as `residential` would quietly thicken
		// the grid with geometry that is not lit in reality.
		for (const junk of ['footway', 'service', 'track', 'cycleway', undefined, '']) {
			expect(normaliseClass(junk as string), String(junk)).toBeNull();
		}
	});
});

describe('overpass ways to slim GeoJSON', () => {
	it('emits the shape world/roads-geojson parses', () => {
		const { features } = overpassToRoadGeoJson({
			elements: [way(1, 'primary', [[78.4, 17.4], [78.41, 17.41]])],
		});
		expect(features).toHaveLength(1);
		expect(features[0].properties).toEqual({ class: 'primary' });
		expect(features[0].geometry.type).toBe('LineString');
	});

	it('carries class and geometry ONLY', () => {
		// Names/refs/lanes are ~4x the bytes for data the renderer cannot use —
		// it draws coloured lines, it does not label them. This file rides
		// `git pull` to the fleet, so bytes are the deploy budget.
		const { features } = overpassToRoadGeoJson({
			elements: [{
				type: 'way', id: 1,
				tags: { highway: 'primary', name: 'Tank Bund Road', lanes: '4', surface: 'asphalt' },
				geometry: [{ lon: 78.4, lat: 17.4 }, { lon: 78.41, lat: 17.41 }],
			}],
		});
		expect(Object.keys(features[0].properties)).toEqual(['class']);
	});

	it('does not emit the same way twice across overlapping radius queries', () => {
		// THE dedup case. The 40 km arterial ring and the 6 km residential ring
		// overlap at the centre, so without a shared `seen` set every arterial
		// near downtown is emitted twice — and duplicated translucent lines
		// composite to double alpha on exactly the geometry drawn brightest.
		const seen = new Set<number>();
		const wide = overpassToRoadGeoJson(
			{ elements: [way(42, 'motorway', [[78.4, 17.4], [78.41, 17.41]])] }, seen,
		);
		const narrow = overpassToRoadGeoJson(
			{ elements: [way(42, 'motorway', [[78.4, 17.4], [78.41, 17.41]])] }, seen,
		);
		expect(wide.features).toHaveLength(1);
		expect(narrow.features).toHaveLength(0);
	});

	it('rounds coordinates to about a metre', () => {
		const { features } = overpassToRoadGeoJson({
			elements: [way(1, 'primary', [[78.4123456789, 17.4123456789], [78.42, 17.42]])],
		});
		const [lon, lat] = features[0].geometry.coordinates[0];
		expect(String(lon).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
		expect(String(lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
	});

	it('collapses vertices that rounding made identical', () => {
		// Rounding can merge neighbours; a run of duplicates makes Cesium's
		// PolylineCollection drop the line entirely rather than error.
		const { features } = overpassToRoadGeoJson({
			elements: [way(1, 'primary', [
				[78.400001, 17.400001], [78.400002, 17.400002], [78.41, 17.41],
			])],
		});
		expect(features[0].geometry.coordinates).toHaveLength(2);
	});

	it('drops ways that collapse below two vertices', () => {
		expect(overpassToRoadGeoJson({
			elements: [way(1, 'primary', [[78.400001, 17.400001], [78.400002, 17.400002]])],
		}).features).toHaveLength(0);
	});

	it('ignores nodes, relations and untagged ways rather than throwing', () => {
		const { features } = overpassToRoadGeoJson({
			elements: [
				{ type: 'node', id: 1, geometry: [{ lon: 1, lat: 2 }] },
				{ type: 'way', id: 2, geometry: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }] },
				{ type: 'way', id: 3, tags: { highway: 'primary' } },
			],
		});
		expect(features).toEqual([]);
	});

	it('survives an empty Overpass response', () => {
		expect(overpassToRoadGeoJson({ elements: [] }).features).toEqual([]);
	});
});
