/**
 * lab-debug.ts
 *
 * Tiny, lab-only debug bridge for the hybrid three lab.
 * Used by /playground for real-time artistic layer visibility.
 *
 * This entire file is intentionally small and deletable once the hybrid
 * validation work is complete.
 */

export const hybridDebug = {
	godrayOpacity: 0,
	bloomThreshold: 0,
	postprocessActive: false,
};

// Helper called from EffectStack (lab only)
export function updateHybridDebug(values: Partial<typeof hybridDebug>) {
	Object.assign(hybridDebug, values);
}
