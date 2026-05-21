import type { Effect } from '$lib/scene/types';
import { Z } from '$lib/scene/layers';
import ViirsGridEffect from './ViirsGridEffect.svelte';

/**
 * VIIRS CSS grid blocks — procedural city-block overlay.
 *
 * Mounted whenever the location has any night-light density (oceans
 * skip it entirely via the `when` predicate). The effect itself
 * additionally gates per-cell brightness so dim cells don't render
 * DOM nodes.
 */
export const viirsGrid: Effect = {
	id: 'viirs-grid',
	kind: 'atmo',
	z: Z.viirsGrid,
	component: ViirsGridEffect,
	when: (m) => m.currentLocation.scene.nightLightDensity > 0.02,
};
