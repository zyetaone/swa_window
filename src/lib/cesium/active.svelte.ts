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

import type { CesiumManager } from './manager';

class ActiveCesium {
	manager = $state<CesiumManager | null>(null);
}

export const activeCesium = new ActiveCesium();
