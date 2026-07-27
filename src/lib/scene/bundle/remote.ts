/**
 * Remote push poll client — over-the-internet "firmware update" channel.
 *
 * Polls a Cloudflare Worker (see tools/aero-push-worker) for new content
 * bundles and per-device config patches. De-duplicates by ID so callbacks
 * only fire on new arrivals. Silent-fails on network errors — the kiosk
 * never blocks on this; it's strictly additive to the LAN fleet channel.
 *
 * This file is intentionally standalone — no fleet imports, no model
 * imports. Wiring lives in +page.svelte.
 */

import type { ContentBundle } from './types';

export type { ContentBundle };

export interface ConfigPatch {
	path: string;
	value: unknown;
}

interface RemotePollOptions {
	deviceId: string;
	pushWorkerUrl: string;
	intervalMs?: number;
	onBundles: (bundles: ContentBundle[]) => void;
	onConfigs: (patches: ConfigPatch[]) => void;
	/** Optional override — defaults to the global fetch. Useful for tests. */
	fetchImpl?: typeof fetch;
}

interface RemotePollHandle {
	stop: () => void;
}

const DEFAULT_INTERVAL_MS = 60_000;

function joinUrl(base: string, path: string): string {
	const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
	return `${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchJson<T>(
	url: string,
	fetchImpl: typeof fetch,
	signal: AbortSignal
): Promise<T | null> {
	try {
		const res = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
		if (!res.ok) {
			console.warn(`[remote-poll] ${url} → HTTP ${res.status}`);
			return null;
		}
		return (await res.json()) as T;
	} catch (err) {
		if ((err as { name?: string })?.name === 'AbortError') return null;
		console.warn(`[remote-poll] ${url} failed`, err);
		return null;
	}
}

/**
 * Start polling the push Worker. Returns a handle with `stop()` to cancel.
 *
 * Behaviour:
 *  - Fires once immediately, then every `intervalMs`.
 *  - Bundles are de-duped by `id` across the lifetime of this handle, so
 *    `onBundles` only sees newly-arrived bundles.
 *  - Configs are sent through every cycle (the patch list is small and
 *    idempotent — caller decides whether to re-apply).
 *  - All network errors are logged, never thrown.
 */
export function startRemotePoll(opts: RemotePollOptions): RemotePollHandle {
	const {
		deviceId,
		pushWorkerUrl,
		intervalMs = DEFAULT_INTERVAL_MS,
		onBundles,
		onConfigs,
		fetchImpl = fetch
	} = opts;

	if (!deviceId || !pushWorkerUrl) {
		console.warn('[remote-poll] disabled — missing deviceId or pushWorkerUrl');
		return { stop: () => undefined };
	}

	const seenBundleIds = new Set<string>();
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const bundlesUrl = joinUrl(pushWorkerUrl, `/bundles/${encodeURIComponent(deviceId)}`);
	const configsUrl = joinUrl(pushWorkerUrl, `/configs/${encodeURIComponent(deviceId)}`);

	const tick = async (): Promise<void> => {
		if (stopped) return;

		const [bundles, patches] = await Promise.all([
			fetchJson<ContentBundle[]>(bundlesUrl, fetchImpl, controller.signal),
			fetchJson<ConfigPatch[]>(configsUrl, fetchImpl, controller.signal)
		]);

		if (!stopped && Array.isArray(bundles)) {
			const fresh = bundles.filter((b) => b && typeof b.id === 'string' && !seenBundleIds.has(b.id));
			for (const b of fresh) seenBundleIds.add(b.id);
			if (fresh.length > 0) {
				try {
					onBundles(fresh);
				} catch (err) {
					console.warn('[remote-poll] onBundles handler threw', err);
				}
			}
		}

		if (!stopped && Array.isArray(patches) && patches.length > 0) {
			try {
				onConfigs(patches);
			} catch (err) {
				console.warn('[remote-poll] onConfigs handler threw', err);
			}
		}

		if (!stopped) timer = setTimeout(tick, intervalMs);
	};

	// Kick off immediately.
	void tick();

	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
			controller.abort();
		}
	};
}

// Device identity comes from the fleet SSOT — the OTA per-device config
// queue and the CRDT sourceId MUST be the same identity (they diverged
// when this file carried its own resolver with different precedence).
export { resolveDeviceId } from '$lib/fleet/device-id';

// ─── Local content hydration ───────────────────────────────────────────────

import { bundleStore } from './store.svelte';

/** GET /api/content → install each bundle into the reactive store. */
export async function hydrateFromServer(): Promise<void> {
	try {
		const res = await fetch('/api/content');
		if (!res.ok) return;
		const data = (await res.json()) as { bundles?: ContentBundle[] };
		if (!Array.isArray(data.bundles)) return;
		for (const bundle of data.bundles) bundleStore.install(bundle);
	} catch {
		// Network/device-off — silent. Stock effects continue to render.
	}
}
