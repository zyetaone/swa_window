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
 *   - Self is INCLUDED. It once wasn't ("local config was already mutated")
 *     — but that conflated the ADMIN tab's config tree with the KIOSK tab's:
 *     separate pages, separate module instances. Skipping self left the
 *     admin-host Pi's own kiosk on stale ambient values while the rest of
 *     the wall updated. The loopback PATCH lands on the host's own SSE bus
 *     and reaches its kiosk like any peer's.
 *   - Timestamp + sourceId are included so CRDT merge gates the write on
 *     the receiving device (concurrent-admin-write safety).
 *   - Caller controls lifecycle via the returned stop function. The
 *     effect is created via `$effect.root` so it survives outside the
 *     component that called startPeerSync.
 */

import { config } from '$lib/model/config-tree.svelte';
// The list itself lives in `$lib/model/peer-sync-paths` — persistence.ts
// validates restored values against it and must stay free of rune/fleet
// imports. Re-exported here so existing fleet/panel consumers keep working.
import { PEER_SYNC_PATHS } from '$lib/model/peer-sync-paths';
import { readByPath } from '$lib/utils';
import type { RestAdminStore } from './rest-admin.svelte';

export { PEER_SYNC_PATHS };

// ── Ambient push failure log ────────────────────────────────────────────────
// The fan-out below is fire-and-forget: a rejected push (offline/rebooting
// Pi) used to be swallowed by `.catch(() => {})`, leaving the admin sliders
// purely optimistic. Now the last few failures are recorded for the admin
// UI (`/admin` Ambient section). Retries are deliberately NOT implemented —
// visibility only; retrying is a future step (the next slider move re-pushes
// the current value anyway, and a rebooted Pi restores ambient values from
// its own persisted state).

export interface AmbientSyncFailure {
	deviceId: string;
	path: string;
	/** Wall-clock ms (Date.now()) when the push rejected. */
	at: number;
}

const MAX_AMBIENT_FAILURES = 20;
const _ambientFailures = $state<AmbientSyncFailure[]>([]);

/** Readonly view of recent ambient push failures, oldest first (reactive). */
export function getAmbientSyncFailures(): readonly AmbientSyncFailure[] {
	return _ambientFailures;
}

export function clearAmbientSyncFailures(): void {
	_ambientFailures.length = 0;
}

function recordAmbientSyncFailure(deviceId: string, path: string): void {
	_ambientFailures.push({ deviceId, path, at: Date.now() });
	if (_ambientFailures.length > MAX_AMBIENT_FAILURES) {
		_ambientFailures.splice(0, _ambientFailures.length - MAX_AMBIENT_FAILURES);
	}
}

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
				// Self included — the admin tab's config tree is NOT the kiosk
				// tab's; the loopback PATCH is how the host Pi's own kiosk
				// hears about ambient slider moves (see header).
				for (const peer of store.peers) {
					void store.pushConfigPath(peer.deviceId, path, value).catch(() => {
						// No retry (see header note above) — record for the admin UI.
						recordAmbientSyncFailure(peer.deviceId, path);
					});
				}
			}
			snapshot = next;
		});
	});

	return cleanup;
}
