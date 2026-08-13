/**
 * peer-sync path SSOT — dual-tree panel writes must be watchable.
 */
import { describe, it, expect } from 'vitest';
import { PEER_SYNC_PATHS, readPeerSyncPath } from '$lib/fleet/peer-sync.svelte';
import { applyConfigPatch, config } from '$lib/model/config-tree.svelte';

describe('PEER_SYNC_PATHS', () => {
	it('lists unique dotted paths under known namespaces', () => {
		const seen = new Set<string>();
		for (const path of PEER_SYNC_PATHS) {
			expect(path).toMatch(/^(atmosphere|director|world|shell)\./);
			expect(seen.has(path)).toBe(false);
			seen.add(path);
		}
	});

	it('readPeerSyncPath returns live config leaves', () => {
		expect(readPeerSyncPath('world.showClouds')).toBe(config.world.showClouds);
		expect(readPeerSyncPath('world.qualityMode')).toBe(config.world.qualityMode);
		expect(readPeerSyncPath('atmosphere.clouds.density')).toBe(config.atmosphere.clouds.density);
	});

	it('applyConfigPatch is visible to readPeerSyncPath', () => {
		const before = config.world.showClouds;
		const next = !before;
		expect(applyConfigPatch('world.showClouds', next)).toBe(true);
		expect(readPeerSyncPath('world.showClouds')).toBe(next);
		// restore
		applyConfigPatch('world.showClouds', before);
	});

	it('includes dual-tree panel paths (flight + shell chrome)', () => {
		expect(PEER_SYNC_PATHS).toContain('director.autopilot.nightLitCitiesOnly');
		expect(PEER_SYNC_PATHS).toContain('shell.clockVisible');
		expect(readPeerSyncPath('director.autopilot.nightLitCitiesOnly')).toBe(
			config.director.autopilot.nightLitCitiesOnly,
		);
		expect(readPeerSyncPath('shell.clockVisible')).toBe(config.shell.clockVisible);
	});
});
