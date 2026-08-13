/**
 * Peer-sync — propagate local config edits to every discovered peer.
 *
 * Admin + dual-tree panel controls write through `applyConfigPatch` into the
 * global config rune (`$lib/model/config-tree.svelte`). This module hooks a
 * `$effect` to the same paths. When any watched field changes, the delta is
 * POSTed as a path-keyed PATCH to every peer's `/api/config` endpoint.
 *
 * Intentional design choices:
 *   - No debounce. Each slider tick is one request. LAN latency is ~2 ms
 *     per peer; six peers × 2 ms = 12 ms total. If this ever becomes a
 *     bottleneck, add request batching here — not in callers.
 *   - No self-fetch. The local config was already mutated by the patch;
 *     we only push to peers other than `self`.
 *   - Timestamp + sourceId are included so CRDT merge gates the write on
 *     the receiving device (concurrent-admin-write safety).
 *   - Caller controls lifecycle via the returned stop function. The
 *     effect is created via `$effect.root` so it survives outside the
 *     component that called startPeerSync.
 */

import { config } from '$lib/model/config-tree.svelte';
import { readByPath } from '$lib/utils';
import type { RestAdminStore } from './rest-admin.svelte';

/**
 * Paths dual-tree operator panels write (FlightControls + AtmosphereControls
 * + LightingControls). SSOT for admin→fleet ambient sync — add a path here
 * when a shared panel gains a new patch target. Keep alphabetical by
 * namespace so diffs stay readable.
 *
 * Device-local chrome (role FOV, etc.) stays out of this list.
 */
export const PEER_SYNC_PATHS = [
	'atmosphere.clouds.density',
	'atmosphere.clouds.speed',
	'atmosphere.haze.amount',
	'director.autopilot.nightLitCitiesOnly',
	'shell.clockVisible',
	'shell.hudVisible',
	'shell.mouseParallax',
	'shell.touchEnabled',
	'shell.windowFrame',
	'world.additiveStrength',
	'world.buildingsEnabled',
	'world.moonlightIntensity',
	'world.nightExposure',
	'world.nightLightIntensity',
	'world.qualityMode',
	'world.showClouds',
	'world.skyDarken',
	'world.useCesiumClouds',
	'world.useHashPalette',
	'world.useThreeOverlay',
	'world.viirsBrightness',
	'world.wingDriftSign',
	'world.wingXBase',
] as const;

const _configRoot = config as unknown as Record<string, unknown>;

/** Read a dotted path off the live config root (reactive when called in $effect). */
export function readPeerSyncPath(path: string): unknown {
	return readByPath(_configRoot, path);
}

/**
 * Start propagating local config edits to every peer in the store.
 * Returns a stop() function that tears down the effect.
 *
 * Uses `$effect.root` (not a plain `$effect`) so peer-sync survives
 * the component that called it. The admin route unmounts when the
 * operator navigates to /admin/content or /admin/fleet/health; a
 * plain `$effect` would stop syncing at that point, silently
 * breaking fleet propagation.
 */
export function startPeerSync(store: RestAdminStore): () => void {
	let snapshot = PEER_SYNC_PATHS.map((p) => readPeerSyncPath(p));

	const cleanup = $effect.root(() => {
		$effect(() => {
			const next = PEER_SYNC_PATHS.map((p) => readPeerSyncPath(p));
			for (let i = 0; i < PEER_SYNC_PATHS.length; i++) {
				if (next[i] === snapshot[i]) continue;
				const path = PEER_SYNC_PATHS[i];
				const value = next[i];
				// Fire-and-forget per changed path. Peer errors don't block UI.
				for (const peer of store.peers) {
					if (peer.self) continue;
					void store.pushConfigPath(peer.deviceId, path, value).catch(() => { /* fire-and-forget: no retry — a failed push is lost until the next change to this path */ });
				}
			}
			snapshot = next;
		});
	});

	return cleanup;
}
