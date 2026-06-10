/**
 * world-three/lighting — Three-side entry point for the unified lighting SSOT.
 *
 * The curves now live in the framework-free $lib/world-lighting/curves so the
 * Cesium side (world/compose.ts) reads the SAME source — no cross-boundary
 * drift (the "white horizon band seam"). This thin re-export keeps existing
 * Three consumers' `./lighting` import paths unchanged.
 */
export { lightingState } from '$lib/world-lighting/curves';
export type { LightingState } from '$lib/world-lighting/curves';
