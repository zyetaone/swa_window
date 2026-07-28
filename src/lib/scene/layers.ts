/**
 * Z-layer ordering — single source of truth.
 */

export const Z = {
	/** Cesium canvas — terrain, buildings, NASA VIIRS night lights */
	cesium: 0,
	/** Rain streaks (above clouds, below frost) */
	rain: 2,
	/** Frost overlay (high-altitude ice crystals) */
	frost: 5,
} as const;
