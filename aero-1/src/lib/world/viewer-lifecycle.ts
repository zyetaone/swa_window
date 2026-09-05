/**
 * One teardown contract for every subsystem that holds Cesium state.
 *
 * ─── The bug this exists to stop ────────────────────────────────────────────
 * `world/` modules are module-level singletons, but the VIEWER is not. Cesium
 * auto-retry, HMR and page nav all replace the viewer, and every handle,
 * layer, primitive and EpsilonGate captured against the old one is then either
 * attached to a destroyed scene or lying about what the new scene contains.
 *
 * Nothing throws when this happens. The globe just renders bare, or the
 * skyline never appears, or a gate reports "unchanged" and skips a write
 * forever. It has now happened four separate times — the Ion tileset, the
 * imagery layers, the EpsilonGates, and the offline building cache.
 *
 * ─── Why a registry rather than another comment ─────────────────────────────
 * Each module already did the right thing, and each carries a comment
 * explaining the lesson. That was never the failure. The failure is that
 * teardown lived in TWO different conventions —
 *
 *   destroyX()            explicit, called from CesiumManager.destroy()
 *                         (lightning, cloud billboards)
 *   reset inside initX()  implicit, relies on the NEXT mount
 *                         (imagery, buildings, atmosphere, terrain)
 *
 * — so any state belonging to neither list was cleared by neither path. That
 * is exactly how the building cache slipped through: buildings' own init reset
 * was correct, and the new state simply lived in a different module.
 *
 * Now there is one list. A subsystem registers once, at module scope, and
 * `teardownViewerState()` runs the lot. Registration is asserted by
 * tests/lib/world/viewer-lifecycle.test.ts, which fails when a `world/` module
 * holds viewer-scoped state and is not registered — so the NEXT occurrence is
 * a red CI run rather than a bare globe someone notices in Hyderabad.
 *
 * Deliberately NOT a general lifecycle framework: no init, no ordering, no
 * dependency graph. Teardown is the only part that kept going wrong, so
 * teardown is the only part modelled.
 */

/** name → teardown. A Map so a module re-registering (HMR) replaces itself. */
const _teardowns = new Map<string, () => void>();

/**
 * Register a subsystem's teardown. Call at MODULE SCOPE, not inside init —
 * registration must happen on import, so a subsystem that was mounted but
 * never re-initialised is still torn down.
 */
export function registerViewerTeardown(name: string, teardown: () => void): void {
	_teardowns.set(name, teardown);
}

/**
 * Drop all viewer-scoped state. Called by CesiumManager.destroy() BEFORE the
 * viewer itself goes away.
 *
 * One subsystem's failure must not strand the rest — a half-torn-down world is
 * how you get the bare globe this file exists to prevent — so each teardown is
 * isolated.
 */
export function teardownViewerState(): void {
	for (const [name, teardown] of _teardowns) {
		try {
			teardown();
		} catch (e) {
			console.warn(`[viewer-lifecycle] ${name} teardown failed:`, e);
		}
	}
}

/** Registered subsystem names — used by the coverage test. */
export function registeredViewerTeardowns(): string[] {
	return [..._teardowns.keys()].sort();
}
