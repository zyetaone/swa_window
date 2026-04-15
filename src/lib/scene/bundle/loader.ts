/**
 * Bundle loader — turns a ContentBundle into a rendered Effect by dispatching
 * on bundle.type. Extend the switch when adding a new BundleType.
 *
 * Pure function — no side effects, no DOM, no Cesium. Returns an Effect
 * (or null if the bundle type is unknown / malformed) and the caller decides
 * what to do with it (register in bundleStore, drop, re-raise, etc.).
 */

import type { Effect } from '../types';
import type { ContentBundle } from './types';
import { createVideoBgEffect } from '../effects/video-bg/factory';
import { createSpriteEffect } from '../effects/sprite/factory';

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

/** Minimal shape guard — confirms the value looks like a ContentBundle before dispatch. */
export function isContentBundle(value: unknown): value is ContentBundle {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	if (typeof v.id !== 'string' || v.id.length === 0) return false;
	if (typeof v.type !== 'string') return false;
	if (typeof v.kind !== 'string') return false;
	if (typeof v.z !== 'number') return false;
	return true;
}
