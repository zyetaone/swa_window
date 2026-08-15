/**
 * All three imagery layers must agree about whether local tiles exist.
 *
 * The bug this pins: base imagery consulted the hasTiles probe, while the VIIRS
 * and road-mask layers keyed off TILE_SERVER_URL merely being SET. install.sh
 * writes that variable on every Pi (default `/api/tiles`), so on a fleet with no
 * tiles packaged the base streamed correctly from EOX while every VIIRS and road
 * tile 404'd — leaving night with no ground light field and no street grid, the
 * two layers that carry the city.
 *
 * It was silent by construction: a 404 on a Cesium ImageryLayer is a blank tile,
 * not an error, and /api/tiles/health reports layer DIRECTORIES, not content.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('src/lib/world/imagery.ts', 'utf8');

describe('local-tile gating is consistent across layers', () => {
	it('derives tileBase from the hasTiles probe, not from the URL being set', () => {
		// The literal that caused it:  const tileBase = TILE_SERVER_URL?...
		// Anything of that shape is the bug returning.
		const bare = /const\s+tileBase\s*=\s*TILE_SERVER_URL/.test(SRC);
		expect(bare).toBe(false);

		// And the fixed shape: the probe result must gate it.
		const gated = /const\s+tileBase\s*=\s*localTiles\s*\?/.test(SRC);
		expect(gated).toBe(true);
	});

	it('still feeds the same probe result to the base imagery selection', () => {
		// Guards the other half of the agreement — if someone "simplifies" by
		// dropping the argument, the layers diverge again in the opposite
		// direction.
		expect(/getSatelliteImagery\(\s*localTiles\s*\)/.test(SRC)).toBe(true);
	});

	it('probes the tile server before choosing any source', () => {
		const probeAt = SRC.indexOf('checkLocalTileServer(');
		const tileBaseAt = SRC.search(/const\s+tileBase\s*=/);
		expect(probeAt).toBeGreaterThan(-1);
		expect(tileBaseAt).toBeGreaterThan(probeAt);
	});
});
