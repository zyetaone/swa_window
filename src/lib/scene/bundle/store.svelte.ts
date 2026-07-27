/**
 * Bundle store — reactive registry of effects derived from pushed bundles.
 *
 * Scene compositor reads `bundleStore.effects` and merges with the static
 * registry. Adding/removing a bundle mutates the list reactively, so effects
 * appear/disappear without a page reload.
 *
 * Phase 3a: in-memory only. Phase 3b will hydrate from the local HTTP
 * content endpoint (/api/content GET) on boot and listen for updates.
 */

import type { Effect } from '../types';
import type { ContentBundle } from './types';
import { isContentBundle } from './types';
import { createSpriteEffect } from '../effects/sprite/factory';
import { createVideoBgEffect } from '../effects/video-bg/factory';

export function createEffectFromBundle(bundle: ContentBundle): Effect | null {
	switch (bundle.type) {
		case 'video-bg':
			// Effect<TParams> is invariant in Props (Svelte's Component type is
			// invariant on its props). We erase the TParams here so the caller
			// can collect heterogeneously-parameterized effects in one array.
			return createVideoBgEffect(bundle) as unknown as Effect;
		case 'sprite':
			return createSpriteEffect(bundle) as unknown as Effect;
		default: {
			// Exhaustiveness check — TS will fail here if a new BundleType is added
			// without a matching case, reminding the implementer to handle it.
			const _exhaustive: never = bundle;
			void _exhaustive;
			return null;
		}
	}
}



class BundleStore {
	/** Installed bundles, keyed by bundle.id. */
	readonly bundles = $state<Map<string, ContentBundle>>(new Map());

	/** Derived: reactive array of Effects for the compositor. */
	readonly effects = $derived.by<Effect[]>(() => {
		const out: Effect[] = [];
		for (const bundle of this.bundles.values()) {
			const effect = createEffectFromBundle(bundle);
			if (effect) out.push(effect);
		}
		return out;
	});

	/**
	 * Install or replace a bundle. Returns true on success, false if the
	 * bundle shape is invalid or the type has no factory.
	 */
	install(bundle: unknown): boolean {
		if (!isContentBundle(bundle)) return false;
		const effect = createEffectFromBundle(bundle);
		if (!effect) return false;
		this.bundles.set(bundle.id, bundle);
		return true;
	}

	/** Remove a bundle by id. Returns true if the bundle was present. */
	remove(id: string): boolean {
		return this.bundles.delete(id);
	}

	/** Clear all installed bundles. Used for tests and factory reset. */
	clear(): void {
		this.bundles.clear();
	}

	/** True if a bundle with this id is installed. */
	has(id: string): boolean {
		return this.bundles.has(id);
	}
}

export const bundleStore = new BundleStore();
