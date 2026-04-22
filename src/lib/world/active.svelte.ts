/**
 * Reactive holder for the currently-mounted CesiumManager.
 *
 * Globe.svelte assigns `manager` on mount and clears it on destroy.
 * Scene effects that need Cesium (geo-positioned effects like car lights,
 * passing planes) subscribe to `activeCesium.manager` inside a $effect —
 * they mount their primitives when it becomes non-null, tear down on null.
 *
 * Module-level $state is intentional: Globe lives as a sibling of the
 * scene Compositor in the component tree, so Svelte context can't bridge
 * them. A single global reactive slot is the pragmatic answer, and since
 * SSR is disabled (kiosk-only) there's no cross-request contamination risk.
 */

import type { CesiumManager } from './compose';

export type CesiumCleanup = (() => void) | void;

export function useCesiumEffect(
	fn: (mgr: CesiumManager, Cesium: typeof import('cesium'), viewer: any) => CesiumCleanup
): void {
	$effect(() => {
		const mgr = activeCesium.manager;
		if (!mgr) return;
		const Cesium = mgr.getCesium();
		const viewer = mgr.getViewer();
		const cleanup = fn(mgr, Cesium, viewer);
		return () => {
			if (typeof cleanup === 'function') cleanup();
		};
	});
}

class ActiveCesium {
	manager = $state<CesiumManager | null>(null);
}

export const activeCesium = new ActiveCesium();
