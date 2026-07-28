/**
 * Z-layer ordering — single source of truth.
 *
 * Only the layered z-indices the compositor exposes as CSS variables.
 * Module kept minimal after the 2026-07 consolidation — effect-layer
 * z-indices now live with each effect component directly (inline).
 */

export const Z = {
	/** Cesium canvas — terrain, buildings, NASA VIIRS night lights */
	cesium: 0,
	/** Rain streaks (above clouds, below frost) */
	rain: 2,
	/** Frost overlay (high-altitude ice crystals) */
	frost: 5,
} as const;
