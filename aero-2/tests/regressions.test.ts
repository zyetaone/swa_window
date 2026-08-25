import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tileTemplates } from '#lib/settings/tiles.js';
import { PaneSettings, KNOB_RANGE } from '#lib/settings/settings.svelte.js';

/**
 * Guards for bugs that have already shipped once and were re-broken by later
 * refactors. Each one cost a real debugging session, and comments alone did not
 * hold — the NAIP guard was removed three separate times.
 */

/**
 * Find a source file by name, wherever it currently lives under src/.
 *
 * Deliberately NOT a hardcoded path: this guard has already been silently
 * disabled once by a folder move (display/ → display/world/), which turned a
 * real regression check into an ENOENT. A guard that a refactor can switch off
 * by accident is not a guard.
 */
function findSource(fileName: string): string {
	const walk = (dir: string): string | null => {
		for (const entry of readdirSync(dir)) {
			const p = join(dir, entry);
			if (statSync(p).isDirectory()) {
				const hit = walk(p);
				if (hit) return hit;
			} else if (entry === fileName) {
				return p;
			}
		}
		return null;
	};

	const found = walk('src');
	if (!found) throw new Error(`${fileName} not found under src/ — was it renamed?`);
	return readFileSync(found, 'utf8');
}

describe('tile URL shape', () => {
	it('keeps the xyz/ segment and the file extension', () => {
		// The route matches `xyz/{layer}/{z}/{x}/{y}.{ext}` and uses it to flip x/y
		// into the on-disk WMTS layout. Drop either part and EVERY tile 404s.
		for (const [layer, tpl] of Object.entries(tileTemplates())) {
			expect(tpl[0], `${layer} must route through /api/tiles`).toContain('/api/tiles/');
			expect(tpl[0], `${layer} needs the xyz/ segment`).toContain('/xyz/');
			expect(tpl[0], `${layer} needs a file extension`).toMatch(/\.(jpg|png)$/);
		}
	});

	it('never names an upstream host - only api/tiles/+server.ts may do that', () => {
		for (const tpl of Object.values(tileTemplates()).flat()) {
			expect(tpl).not.toMatch(/amazonaws|earthdata|nationalmap/);
		}
	});
});

describe('GroundLayers', () => {
	it('unmounts the USGS source rather than fading it to zero', () => {
		// `raster-opacity: 0` hides a raster layer but does NOT stop it fetching.
		// Over Hyderabad (no NAIP coverage) that meant hundreds of 404s per second
		// for a layer nobody could see. A layer that renders nothing must not exist.
		const src = findSource('Ground.svelte');
		const usgsIndex = src.indexOf('id="usgs"');
		expect(usgsIndex, 'usgs source should exist').toBeGreaterThan(-1);

		const before = src.slice(0, usgsIndex);
		expect(
			before,
			'the usgs RasterTileSource must sit inside an {#if} on the detail opacity'
		).toMatch(/\{#if[^}]*etail[^}]*>\s*0\s*\}[\s\S]*$/);
	});
});

describe('the plane actually flies', () => {
	/**
	 * A restructure once deleted the frame loop and left `advanceTo()` with no
	 * caller. The view was computed once at construction and never again, so the
	 * window was a still photograph — while type-check, every unit test, the
	 * canvas mount and the console were all perfectly clean. Nothing but two
	 * screenshots five seconds apart could see it.
	 */
	it('drives the camera every frame from the flight pose', () => {
		const src = findSource('Stage.svelte');

		expect(src, 'something must schedule frames').toMatch(/requestAnimationFrame/);
		expect(src, 'each frame must advance the simulation clock').toMatch(/advanceTo\s*\(/);
		expect(src, 'each frame must move the MapLibre camera').toMatch(/jumpTo\s*\(/);
		expect(src, 'camera must be placed by real altitude, not a zoom level').toMatch(
			/calculateCameraOptionsFromTo/
		);
		expect(src, 'the loop must be cancelled on teardown').toMatch(/cancelAnimationFrame/);
	});

	it('does not let map controls fight the frame loop', () => {
		const src = findSource('Stage.svelte');

		// Both are overwritten by the very next frame, because the loop re-derives
		// the whole camera from the pose. Controls must change the params the pose
		// is computed FROM instead.
		expect(src, 'panBy is undone next frame — nudge azimuth instead').not.toMatch(/\.panBy\s*\(/);
		expect(src, 'bind:pitch fights the camera driver').not.toMatch(/bind:pitch/);
	});
});

describe('settings write gate', () => {
	/**
	 * `nudge('azimuthDeg')` wrapped into 0..360 while `applyUrl` and the slider
	 * both used -180..180. One press of "pan left" from the -90 default produced
	 * 255: a legal number, off the end of its own slider, and a different bearing
	 * convention from the one the URL uses. Two copies of a range disagreed.
	 */
	it('keeps azimuth in the same signed range the URL and slider use', () => {
		const s = new PaneSettings();
		s.azimuthDeg = -90;
		s.nudge('azimuthDeg', -15);
		expect(s.azimuthDeg).toBe(-105);

		s.azimuthDeg = -175;
		s.nudge('azimuthDeg', -20); // across the seam
		expect(s.azimuthDeg).toBeGreaterThanOrEqual(-180);
		expect(s.azimuthDeg).toBeLessThanOrEqual(180);
	});

	it('clamps every knob into its declared range', () => {
		const s = new PaneSettings();
		for (const key of Object.keys(KNOB_RANGE) as (keyof typeof KNOB_RANGE)[]) {
			const [lo, hi] = KNOB_RANGE[key];
			s.set(key, hi + 1000);
			expect(s[key], `${key} above max`).toBeLessThanOrEqual(hi);
			s.set(key, lo - 1000);
			expect(s[key], `${key} below min`).toBeGreaterThanOrEqual(lo);
		}
	});

	it('ignores NaN rather than poisoning the pose', () => {
		// A NaN knob makes the camera target NaN, which is a black screen with no
		// error — the same failure mode as the URL parser bug.
		const s = new PaneSettings();
		s.set('shade', Number.NaN);
		expect(Number.isFinite(s.shade)).toBe(true);
	});

	it('has no operator control writing config directly', () => {
		// bind:value skips the gate: no clamping now, and no fleet broadcast later.
		const src = findSource('Settings.svelte');
		expect(src, 'sliders must call config.set(), not bind: into config').not.toMatch(
			/bind:value=\{config\./
		);
	});
});
