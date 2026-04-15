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

// Note: `pushBundle()` and `removeBundle()` helpers were removed after knip
// sweep flagged them as dead — the /content drag-drop route uses its own
// inline fetch calls directly. If a second consumer appears, re-introduce
// them here rather than duplicating the try/fetch/store.install dance.
