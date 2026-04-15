/**
 * Client-side bundle helpers — talk to the device's own /api/content HTTP
 * endpoint. Used by the root page on mount to hydrate the reactive store
 * from whatever's been persisted to disk.
 *
 * Silent failure is intentional: the kiosk must never crash or block render
 * because content push is unavailable. Stock effects always work.
 */

import { bundleStore } from './store.svelte';
import type { ContentBundle } from './types';

/** GET /api/content → install each bundle into the reactive store. */
export async function hydrateFromServer(): Promise<void> {
	try {
		const res = await fetch('/api/content');
		if (!res.ok) return;
		const data = (await res.json()) as { bundles?: ContentBundle[] };
		if (!Array.isArray(data.bundles)) return;
		for (const bundle of data.bundles) {
			bundleStore.install(bundle);
		}
	} catch {
		// Network/device-off — silent. Stock effects continue to render.
	}
}

/** POST /api/content — install server-side + reactive install on success. */
export async function pushBundle(bundle: ContentBundle): Promise<boolean> {
	try {
		const res = await fetch('/api/content', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(bundle),
		});
		if (!res.ok) return false;
		bundleStore.install(bundle);
		return true;
	} catch {
		return false;
	}
}

/** DELETE /api/content/[id] — remove server-side + reactive remove. */
export async function removeBundle(id: string): Promise<boolean> {
	try {
		const res = await fetch(`/api/content/${encodeURIComponent(id)}`, {
			method: 'DELETE',
		});
		if (!res.ok) return false;
		bundleStore.remove(id);
		return true;
	} catch {
		return false;
	}
}
