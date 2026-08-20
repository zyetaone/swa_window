/**
 * The vector night road grid — the ODbL replacement for the CartoDB raster.
 *
 * The GL is untestable here, so these cover what is easy to get wrong and
 * impossible to see in a diff: the ground offset, class handling, and the
 * altitude behaviour that decides whether cruise reads as a grid or as haze.
 *
 * The night CURVE itself is NOT retested here — roadMaskAlpha lives in
 * imagery.ts and keeps its own coverage; the point of this layer is that it
 * reuses that function rather than growing a second one.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { polylinesFromGeojson, roadClassAlpha, ROAD_CLASSES } from '$lib/world/roads-geojson';
import { groundAltM } from '$content/locations';

const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });
const road = (cls?: unknown, coords?: unknown) => ({
	type: 'Feature',
	properties: cls === undefined ? {} : { class: cls },
	geometry: {
		type: 'LineString',
		coordinates: coords ?? [[78.48, 17.38], [78.49, 17.39]],
	},
});

describe('roads sit on the ground, not the ellipsoid', () => {
	it('lifts every line to the city ground altitude', () => {
		// Same silent failure as buildings: at sea level Denver's grid is ~1600 m
		// inside the mountain and the city reads as having no roads at all,
		// which is indistinguishable from "the layer failed to load".
		const [r] = polylinesFromGeojson(fc([road('primary')]), 'denver');
		expect(r.altM).toBeGreaterThan(groundAltM('denver'));
		expect(r.altM).toBeLessThan(groundAltM('denver') + 50);
	});

	it('puts a high-altitude city above a low one', () => {
		const [den] = polylinesFromGeojson(fc([road()]), 'denver');
		const [dub] = polylinesFromGeojson(fc([road()]), 'dubai');
		expect(den.altM).toBeGreaterThan(dub.altM);
	});

	it('scales the ground by vertical exaggeration so roads track terrain', () => {
		// verticalExaggeration stretches TERRAIN but not primitives, so an
		// unscaled altitude leaves the grid floating above or buried under the
		// ground it is painted on.
		const [flat] = polylinesFromGeojson(fc([road()]), 'denver', 1);
		const [tall] = polylinesFromGeojson(fc([road()]), 'denver', 2);
		expect(tall.altM - flat.altM).toBeCloseTo(groundAltM('denver'));
	});

	it('lifts clear of the terrain rather than sitting exactly on it', () => {
		// A line at exactly terrain height z-fights into a dashed shimmer.
		const [r] = polylinesFromGeojson(fc([road()]), 'dubai');
		expect(r.altM).toBeGreaterThan(groundAltM('dubai'));
	});
});

describe('class handling is total', () => {
	it('keeps every class the packager emits', () => {
		for (const cls of ROAD_CLASSES) {
			const [r] = polylinesFromGeojson(fc([road(cls)]), 'dubai');
			expect(r?.cls, cls).toBe(cls);
		}
	});

	it('styles an unknown or missing class instead of dropping the road', () => {
		// A road tagged in a way we did not anticipate should still light up,
		// quietly. Dropping it would silently thin the grid as OSM tagging drifts.
		for (const bad of [undefined, 'unclassified', 42, null, '']) {
			const out = polylinesFromGeojson(fc([road(bad)]), 'dubai');
			expect(out, String(bad)).toHaveLength(1);
			expect(out[0].cls, String(bad)).toBe('residential');
		}
	});
});

describe('malformed features degrade instead of blanking the grid', () => {
	it('drops repeated vertices rather than collapsing the line to nothing', () => {
		// PolylineGeometry removes duplicates itself and returns UNDEFINED when
		// fewer than two survive — which surfaces as a missing road, not an error.
		const dup = road('primary', [[78.48, 17.38], [78.48, 17.38], [78.49, 17.39]]);
		const [r] = polylinesFromGeojson(fc([dup]), 'dubai');
		expect(r.coords).toEqual([78.48, 17.38, 78.49, 17.39]);
	});

	it('skips a line whose vertices are all the same point', () => {
		const degenerate = road('primary', [[78.48, 17.38], [78.48, 17.38]]);
		expect(polylinesFromGeojson(fc([degenerate]), 'dubai')).toHaveLength(0);
	});

	it('skips out-of-range coordinates rather than wrapping the globe', () => {
		const bogus = road('primary', [[999, 2], [3, 400]]);
		expect(polylinesFromGeojson(fc([bogus]), 'dubai')).toHaveLength(0);
	});

	it('ignores non-LineString geometry', () => {
		const poly = {
			type: 'Feature',
			properties: { class: 'primary' },
			geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6]]] },
		};
		expect(polylinesFromGeojson(fc([poly]), 'dubai')).toHaveLength(0);
	});

	it('returns empty for junk input rather than throwing into the render loop', () => {
		for (const junk of [null, undefined, {}, { features: 'nope' }, 42]) {
			expect(polylinesFromGeojson(junk, 'dubai')).toEqual([]);
		}
	});
});

describe('per-class alpha keeps the grid legible at cruise', () => {
	const CRUISE = 34_000;

	it('never exceeds the curve it is scaling', () => {
		for (const cls of ROAD_CLASSES) {
			for (const alt of [1_000, 5_000, 28_000, CRUISE]) {
				const a = roadClassAlpha(cls, 1, alt);
				expect(a, `${cls}@${alt}`).toBeLessThanOrEqual(1);
				expect(a, `${cls}@${alt}`).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('keeps arteries brighter than side streets', () => {
		// The whole reason for per-class primitives. Flat weighting reads as a
		// uniform grey mesh with no city structure in it.
		expect(roadClassAlpha('motorway', 1, 28_000)).toBeGreaterThan(
			roadClassAlpha('residential', 1, 28_000),
		);
	});

	it('fades residential with altitude, and only residential', () => {
		// Residential is ~80% of the features (2,749 of Hyderabad's 3,447).
		// Polyline width is CONSTANT SCREEN SPACE, so unlike the raster it
		// replaced, these do not attenuate on their own — at cruise they alias
		// into a haze that buries the arteries.
		expect(roadClassAlpha('residential', 1, CRUISE)).toBeLessThan(
			roadClassAlpha('residential', 1, 5_000),
		);
		expect(roadClassAlpha('motorway', 1, CRUISE)).toBeCloseTo(
			roadClassAlpha('motorway', 1, 5_000),
		);
	});

	it('goes fully dark when the night curve does', () => {
		for (const cls of ROAD_CLASSES) expect(roadClassAlpha(cls, 0, 28_000)).toBe(0);
	});
});

describe('the road cache does not outlive its viewer', () => {
	it('reports nothing loaded after a reset', async () => {
		const { hasOfflineRoads, resetOfflineRoads } = await import('$lib/world/roads-geojson');
		resetOfflineRoads();
		expect(hasOfflineRoads('denver')).toBe(false);
	});

	it('is reached by the teardown contract, not merely available', async () => {
		// Fifth occurrence of this bug class in this repo. Exporting the reset is
		// useless if the lifecycle never calls it, so the registration is what
		// gets pinned — and initRoads must clear on remount too.
		const { readFile } = await import('node:fs/promises');
		const src = await readFile('src/lib/world/roads-geojson.ts', 'utf8');
		expect(src).toContain("registerViewerTeardown('roads-geojson', resetOfflineRoads)");
		const init = src.slice(src.indexOf('export function initRoads'));
		expect(init.slice(0, init.indexOf('\n}'))).toContain('resetOfflineRoads()');
	});
});

/**
 * `data/roads` is tracked as of the CARTO removal — 4.1 MB of ODbL centrelines,
 * and now the ONLY source for the night street grid. Same reasoning as
 * data/buildings: git pull is the deploy mechanism, so an ignored path is one
 * the fleet can never receive.
 *
 * The guard stays anyway. It costs one syscall and keeps the file honest on a
 * checkout where the exception has been reverted, rather than failing with
 * ENOENT — which is exactly how the buildings version took main red.
 *
 * The skip announces itself. A silently-skipped test reads as a passing one.
 */
const packagedData = existsSync('data/roads');
if (!packagedData) {
	console.info('[roads-geojson] data/roads absent — packaged-data checks skipped');
}

describe.runIf(packagedData)('every city that should have a street grid has one packaged', () => {
	it('covers each hasBuildings location in the catalogue', async () => {
		// hasBuildings doubles as "is a city": the eight locations with a skyline
		// are exactly the eight with a road extract. ponytail: no second
		// catalogue flag for a set that is identical — add hasRoads only if a
		// location ever needs one without the other.
		const { LOCATIONS } = await import('$content/locations');
		const missing = LOCATIONS
			.filter((l) => l.hasBuildings)
			.map((l) => l.id)
			.filter((id) => !existsSync(`data/roads/${id}.geojson`));
		expect(
			missing,
			`catalogue cities with no packaged road extract: ${missing.join(', ')}. `
				+ 'Run tools/tile-packager for the new city, or set hasBuildings:false.',
		).toEqual([]);
	});

	it('ships no extract that no location asks for', async () => {
		// These files are in git now, so dead weight is permanent weight.
		const { LOCATIONS } = await import('$content/locations');
		const wanted = new Set(LOCATIONS.filter((l) => l.hasBuildings).map((l) => l.id));
		const stray = readdirSync('data/roads')
			.filter((f) => f.endsWith('.geojson'))
			.map((f) => f.replace(/\.geojson$/, ''))
			.filter((id) => !wanted.has(id as never));
		expect(stray, `packaged extracts no catalogue location uses: ${stray.join(', ')}`).toEqual([]);
	});
});

describe.runIf(packagedData)('the packaged data this layer depends on is real', () => {
	it('parses the shipped city files into usable polylines', async () => {
		// Guards the layer end-to-end short of the GPU: if the packager output
		// ever changes shape, this fails here rather than as a dark city on a Pi.
		const { readFile } = await import('node:fs/promises');
		for (const city of ['hyderabad', 'dubai', 'denver'] as const) {
			const raw = JSON.parse(await readFile(`data/roads/${city}.geojson`, 'utf8'));
			const out = polylinesFromGeojson(raw, city);
			expect(out.length, city).toBeGreaterThan(0);
			expect(out.every((r) => r.coords.length >= 4), city).toBe(true);
			expect(out.every((r) => r.altM > 0), city).toBe(true);
			// The arteries are what carry the city; an extract of nothing but
			// residential lanes means the packager filter regressed.
			expect(out.some((r) => r.cls !== 'residential'), city).toBe(true);
		}
	});
});
