/**
 * The offline buildings tier — the one buildings never had.
 *
 * Terrain and imagery both degrade local → remote → flat. Buildings were Ion
 * or nothing, so a tokenless install showed an empty sky over a lit city.
 *
 * The GL is untestable here, so these cover the two things that are actually
 * easy to get wrong and impossible to see in a diff: the ground offset, and
 * which tier is allowed to draw.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { extrusionsFromGeojson } from '$lib/world/buildings-geojson';
import { groundAltM } from '$content/locations';

const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features });
const box = (height?: unknown) => ({
	type: 'Feature',
	properties: height === undefined ? {} : { height },
	geometry: {
		type: 'Polygon',
		coordinates: [[[78.48, 17.38], [78.49, 17.38], [78.49, 17.39], [78.48, 17.38]]],
	},
});

describe('buildings sit on the ground, not the ellipsoid', () => {
	it('lifts every footprint to the city ground altitude', () => {
		// THE bug this file exists for. OSM `height` is above-ground, Cesium
		// extrudes from the ellipsoid. Without the offset a Denver tower is
		// ~1600 m underground — the city renders empty, with no error, which
		// is indistinguishable from "the tier failed to load".
		const [d] = extrusionsFromGeojson(fc([box(100)]), 'denver');
		expect(d.baseAltM).toBeCloseTo(groundAltM('denver'));
		expect(d.topAltM).toBeCloseTo(groundAltM('denver') + 100);
	});

	it('puts a high-altitude city above a low one', () => {
		const [den] = extrusionsFromGeojson(fc([box(50)]), 'denver');
		const [dub] = extrusionsFromGeojson(fc([box(50)]), 'dubai');
		expect(den.baseAltM).toBeGreaterThan(dub.baseAltM);
	});

	it('scales the base by vertical exaggeration so buildings track terrain', () => {
		// verticalExaggeration stretches TERRAIN but not primitives, so an
		// unscaled base leaves buildings floating above or sunk below the
		// ground they stand on.
		const [flat] = extrusionsFromGeojson(fc([box(50)]), 'denver', 1);
		const [tall] = extrusionsFromGeojson(fc([box(50)]), 'denver', 2);
		expect(tall.baseAltM).toBeCloseTo(flat.baseAltM * 2);
	});

	it('keeps building height itself out of the exaggeration', () => {
		// Only the GROUND is exaggerated; a 50 m building is still 50 m tall.
		const [tall] = extrusionsFromGeojson(fc([box(50)]), 'denver', 2);
		expect(tall.topAltM - tall.baseAltM).toBeCloseTo(50);
	});
});

describe('malformed features degrade instead of breaking the sky', () => {
	it('substitutes a default height rather than dropping untagged footprints', () => {
		const [d] = extrusionsFromGeojson(fc([box(undefined)]), 'dubai');
		expect(d.topAltM).toBeGreaterThan(d.baseAltM);
	});

	it('clamps an absurd height instead of spearing the sky', () => {
		const [d] = extrusionsFromGeojson(fc([box(999_999)]), 'dubai');
		expect(d.topAltM - d.baseAltM).toBeLessThanOrEqual(830);
	});

	it('rejects non-numeric, negative and NaN heights', () => {
		for (const bad of ['tall', -20, NaN, null]) {
			const [d] = extrusionsFromGeojson(fc([box(bad)]), 'dubai');
			expect(d.topAltM, String(bad)).toBeGreaterThan(d.baseAltM);
			expect(Number.isFinite(d.topAltM), String(bad)).toBe(true);
		}
	});

	it('skips rings with too few real vertices', () => {
		const degenerate = {
			type: 'Feature',
			properties: { height: 10 },
			geometry: { type: 'Polygon', coordinates: [[[1, 2], [3, 4]]] },
		};
		expect(extrusionsFromGeojson(fc([degenerate]), 'dubai')).toHaveLength(0);
	});

	it('skips out-of-range coordinates rather than wrapping the globe', () => {
		const bogus = {
			type: 'Feature',
			properties: { height: 10 },
			geometry: { type: 'Polygon', coordinates: [[[999, 2], [3, 400], [5, 6]]] },
		};
		expect(extrusionsFromGeojson(fc([bogus]), 'dubai')).toHaveLength(0);
	});

	it('ignores non-Polygon geometry', () => {
		const line = {
			type: 'Feature',
			properties: { height: 10 },
			geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
		};
		expect(extrusionsFromGeojson(fc([line]), 'dubai')).toHaveLength(0);
	});

	it('returns empty for junk input rather than throwing into the render loop', () => {
		for (const junk of [null, undefined, {}, { features: 'nope' }, 42]) {
			expect(extrusionsFromGeojson(junk, 'dubai')).toEqual([]);
		}
	});
});

describe('the city cache does not outlive its viewer', () => {
	it('reports nothing loaded after a reset', async () => {
		// The remount trap this repo has now hit four times (tileset, imagery
		// layers, EpsilonGates, and this). The cache is a module singleton but
		// the VIEWER is not: after a Cesium auto-retry / HMR / page nav, every
		// cached Primitive belongs to a destroyed scene while the cache still
		// reports the city as loaded — so the loader early-returns, nothing is
		// added to the new scene, and the skyline is gone until a full reload.
		//
		// initBuildings must call resetOfflineBuildings(); this asserts the
		// reset actually clears what hasOfflineBuildings() reads.
		const { hasOfflineBuildings, resetOfflineBuildings } = await import(
			'$lib/world/buildings-geojson'
		);
		resetOfflineBuildings();
		expect(hasOfflineBuildings('denver')).toBe(false);
	});

	it('is reached by the buildings teardown, not merely available', async () => {
		// Exporting the reset is useless if the lifecycle never calls it — the
		// bug was an omission at the call site, so that is what gets pinned.
		//
		// Originally this looked for the call inside initBuildings. The teardown
		// contract (world/viewer-lifecycle) since moved it into the extracted
		// resetBuildingsViewerState, which initBuildings calls and which is also
		// registered for destroy(). Following the indirection rather than
		// loosening the assertion: the property that matters is that the
		// buildings teardown clears the offline cache, wherever it lives.
		const { readFile } = await import('node:fs/promises');
		const src = await readFile('src/lib/world/buildings.ts', 'utf8');
		const fn = src.slice(src.indexOf('export function resetBuildingsViewerState'));
		expect(fn.slice(0, fn.indexOf('\n}'))).toContain('resetOfflineBuildings()');

		const init = src.slice(src.indexOf('export function initBuildings'));
		expect(init.slice(0, init.indexOf('\n}'))).toContain('resetBuildingsViewerState()');
	});
});

/**
 * `data/` is gitignored in full (.gitignore:41) — it is packager OUTPUT, tens
 * of thousands of tiles, deliberately not in the repo. So this block can only
 * run where the packager has been run: a dev machine or the packaging job.
 *
 * It was originally unconditional, which passed locally and took CI red on the
 * first push — the exact hazard of asserting against files the repo does not
 * contain. Made conditional rather than deleted: the shape of the packager's
 * output is worth checking wherever it actually exists, and the shape
 * assertions above already cover the parser itself on every run, from inline
 * fixtures, so CI is not left with a hole.
 *
 * The skip is announced rather than silent — a quietly-skipped test reads as a
 * passing one.
 */
const packagedData = existsSync('data/buildings');
if (!packagedData) {
	console.info('[buildings-offline-tier] data/buildings absent — packaged-data checks skipped');
}

describe.runIf(packagedData)('the packaged data this tier depends on is real', () => {
	it('parses the shipped city files into usable extrusions', async () => {
		// Guards the tier end-to-end short of the GPU: if the packager output
		// ever changes shape, this fails here rather than as an empty sky on
		// a Pi with no token.
		const { readFile } = await import('node:fs/promises');
		for (const city of ['hyderabad', 'dubai', 'denver'] as const) {
			const raw = JSON.parse(await readFile(`data/buildings/${city}.geojson`, 'utf8'));
			const out = extrusionsFromGeojson(raw, city);
			expect(out.length, city).toBeGreaterThan(0);
			expect(out.every((e) => e.topAltM > e.baseAltM), city).toBe(true);
			expect(out.every((e) => e.ring.length >= 6), city).toBe(true);
		}
	});
});
