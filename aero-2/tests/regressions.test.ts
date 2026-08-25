import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tileTemplates } from '#lib/config.js';

/**
 * Guards for bugs that have already shipped once and were re-broken by later
 * refactors. Each one cost a real debugging session, and comments alone did not
 * hold — the NAIP guard was removed three separate times.
 */

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
		const src = readFileSync('src/lib/display/WorldStage.svelte', 'utf8');
		const usgsIndex = src.indexOf('id="usgs"');
		expect(usgsIndex, 'usgs source should exist').toBeGreaterThan(-1);

		const before = src.slice(0, usgsIndex);
		expect(
			before,
			'the usgs RasterTileSource must sit inside an {#if} on the detail opacity'
		).toMatch(/\{#if[^}]*etail[^}]*>\s*0\s*\}[\s\S]*$/);
	});
});
