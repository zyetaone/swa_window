/**
 * Bundle store — reactive registry of pushed bundles.
 *
 * The DOM compositor was deleted; bundles remain as a wire contract for
 * the content API routes but have no runtime mount point. The store accepts
 * bundles and preserves them in memory so the API can still list/install/delete.
 */
import type { ContentBundle } from './types';
import { isContentBundle } from './types';

class BundleStore {
	readonly bundles = $state<Map<string, ContentBundle>>(new Map());

	install(bundle: unknown): boolean {
		if (!isContentBundle(bundle)) return false;
		this.bundles.set(bundle.id, bundle);
		return true;
	}

	remove(id: string): boolean { return this.bundles.delete(id); }
	clear(): void { this.bundles.clear(); }
	has(id: string): boolean { return this.bundles.has(id); }
}

export const bundleStore = new BundleStore();
