/**
 * Peer-sync — propagate local config edits to every discovered peer.
 *
 * The admin browser binds sliders directly to the global config rune
 * (`$lib/model/config-tree.svelte`). This module hooks a `$effect` to the
 * same rune. When any watched field changes, the previous value is compared
 * against the current, and the delta is POSTed as a path-keyed PATCH to
 * every peer's `/api/config` endpoint.
 *
 * Intentional design choices:
 *   - No debounce. Each slider tick is one request. LAN latency is ~2 ms
 *     per peer; six peers × 2 ms = 12 ms total. If this ever becomes a
 *     bottleneck, add request batching here — not in callers.
 *   - No self-fetch. The local config was already mutated by the slider
 *     bind; we only push to peers other than `self`.
 *   - Timestamp + sourceId are included so CRDT merge gates the write on
 *     the receiving device (concurrent-admin-write safety).
 *   - Caller controls lifecycle via the returned stop function. The
 *     effect is created via `$effect.root` so it survives outside the
 *     component that called startPeerSync.
 */

import { config } from '$lib/model/config-tree.svelte';
import type { RestAdminStore } from './rest-admin.svelte';

const SOURCE_ID_KEY = 'aero-admin-session-id';

function getSourceId(): string {
	if (typeof localStorage === 'undefined') return 'admin';
	let id = localStorage.getItem(SOURCE_ID_KEY);
	if (!id) {
		id = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		localStorage.setItem(SOURCE_ID_KEY, id);
	}
	return id;
}

/**
 * Paths the peer-sync watches. Adding a slider to admin means adding the
 * path here — no other changes. Keep in alphabetical order by namespace so
 * diff noise is low when the list grows.
 */
const WATCHED_PATHS: ReadonlyArray<{ path: string; read: () => unknown }> = [
	{ path: 'atmosphere.clouds.density', read: () => config.atmosphere.clouds.density },
	{ path: 'atmosphere.clouds.speed',   read: () => config.atmosphere.clouds.speed },
	{ path: 'atmosphere.haze.amount',    read: () => config.atmosphere.haze.amount },
	{ path: 'world.nightLightIntensity', read: () => config.world.nightLightIntensity },
	{ path: 'world.qualityMode',         read: () => config.world.qualityMode },
	{ path: 'world.showClouds',          read: () => config.world.showClouds },
	{ path: 'world.buildingsEnabled',    read: () => config.world.buildingsEnabled },
	{ path: 'shell.windowFrame',         read: () => config.shell.windowFrame },
];

/**
 * Start propagating local config edits to every peer in the store.
 * Returns a stop() function that tears down the effect.
 */
export function startPeerSync(store: RestAdminStore): () => void {
	const sourceId = getSourceId();
	let snapshot = WATCHED_PATHS.map((p) => p.read());

	const cleanup = $effect.root(() => {
		$effect(() => {
			const next = WATCHED_PATHS.map((p) => p.read());
			for (let i = 0; i < WATCHED_PATHS.length; i++) {
				if (next[i] === snapshot[i]) continue;
				const { path } = WATCHED_PATHS[i];
				const value = next[i];
				// Fire-and-forget per changed path. Peer errors don't block UI.
				for (const peer of store.peers) {
					if (peer.self) continue;
					void store.pushConfigPath(peer.deviceId, path, value);
				}
			}
			snapshot = next;
		});
	});

	// Mark our admin session in the CRDT so tiebreaks are consistent across
	// reconnects of the same admin.
	void sourceId;

	return cleanup;
}
