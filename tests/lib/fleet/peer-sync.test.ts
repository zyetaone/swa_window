/**
 * peer-sync path SSOT — dual-tree panel writes must be watchable.
 */
import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import {
	PEER_SYNC_PATHS,
	readPeerSyncPath,
	startPeerSync,
	getAmbientSyncFailures,
	clearAmbientSyncFailures,
} from '$lib/fleet/peer-sync.svelte';
import { applyConfigPatch, config } from '$lib/model/config-tree.svelte';
import type { RestAdminStore } from '$lib/fleet/rest-admin.svelte';

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

	it('pushes to SELF as well as peers — the admin host kiosk hears ambient edits', () => {
		// Regression: `if (peer.self) continue` conflated the admin tab's config
		// tree with the kiosk tab's (separate pages, separate instances), so the
		// host Pi's own kiosk kept stale ambient values while the wall updated.
		const pushConfigPath = vi.fn().mockResolvedValue(undefined);
		const store = {
			peers: [
				{ deviceId: 'self-pi', host: 'aero-display-00.local', port: 5173, self: true },
				{ deviceId: 'peer-pi', host: 'aero-display-01.local', port: 5173 },
			],
			pushConfigPath,
		} as unknown as RestAdminStore;

		const stop = startPeerSync(store);
		const before = config.world.showClouds;
		try {
			applyConfigPatch('world.showClouds', !before);
			flushSync();
			expect(pushConfigPath).toHaveBeenCalledWith('self-pi', 'world.showClouds', !before);
			expect(pushConfigPath).toHaveBeenCalledWith('peer-pi', 'world.showClouds', !before);
		} finally {
			stop();
			applyConfigPatch('world.showClouds', before);
		}
	});
});

describe('ambient push failure log', () => {
	function failingStore(deviceIds: string[]): RestAdminStore {
		return {
			peers: deviceIds.map((deviceId) => ({ deviceId, host: `${deviceId}.local`, port: 5173 })),
			pushConfigPath: vi.fn().mockRejectedValue(new Error('offline')),
		} as unknown as RestAdminStore;
	}

	it('records deviceId + path + timestamp when a push rejects', async () => {
		clearAmbientSyncFailures();
		const stop = startPeerSync(failingStore(['peer-pi']));
		const before = config.world.showClouds;
		try {
			applyConfigPatch('world.showClouds', !before);
			flushSync();
			await vi.waitFor(() => expect(getAmbientSyncFailures()).toHaveLength(1));
			const failure = getAmbientSyncFailures()[0];
			expect(failure.deviceId).toBe('peer-pi');
			expect(failure.path).toBe('world.showClouds');
			expect(failure.at).toBeGreaterThan(0);
		} finally {
			stop();
			applyConfigPatch('world.showClouds', before);
			clearAmbientSyncFailures();
		}
	});

	it('does not record successful pushes', async () => {
		clearAmbientSyncFailures();
		const store = {
			peers: [{ deviceId: 'peer-pi', host: 'peer-pi.local', port: 5173 }],
			pushConfigPath: vi.fn().mockResolvedValue(undefined),
		} as unknown as RestAdminStore;
		const stop = startPeerSync(store);
		const before = config.world.showClouds;
		try {
			applyConfigPatch('world.showClouds', !before);
			flushSync();
			// Give the (resolved) promise a microtask turn to prove no
			// rejection handler fires.
			await Promise.resolve();
			expect(getAmbientSyncFailures()).toHaveLength(0);
		} finally {
			stop();
			applyConfigPatch('world.showClouds', before);
			clearAmbientSyncFailures();
		}
	});

	it('caps the log at 20 failures (oldest dropped) and clear() empties it', async () => {
		clearAmbientSyncFailures();
		const stop = startPeerSync(failingStore(['peer-pi']));
		const before = config.world.showClouds;
		try {
			for (let i = 0; i < 25; i++) {
				applyConfigPatch('world.showClouds', i % 2 === 0 ? !before : before);
				flushSync();
			}
			await vi.waitFor(() => expect(getAmbientSyncFailures()).toHaveLength(20));
			clearAmbientSyncFailures();
			expect(getAmbientSyncFailures()).toHaveLength(0);
		} finally {
			stop();
			applyConfigPatch('world.showClouds', before);
			clearAmbientSyncFailures();
		}
	});
});
