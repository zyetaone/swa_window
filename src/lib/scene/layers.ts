/**
 * Z-layer ordering — single source of truth.
 *
 * Previously triplicated: registry.ts inline z:N values, Weather.svelte
 * hardcoded z-index, Window.svelte doc-comment table, CLAUDE.md table.
 * They had already drifted (CLAUDE.md documented z:3 micro-events and
 * z:11 glass-recess which Window.svelte's comment omitted).
 *
 * Every call site — effect registry, Weather.svelte, Window.svelte,
 * atmosphere/*, scene/effects/* — imports from here.
 */

export const Z = {
	/** Cesium canvas — terrain, buildings, NASA VIIRS night lights */
	cesium: 0,
	/** Geo-positioned effects (car-lights). Renders inside Cesium; value inert */
	geo: 0,
	/** Atmospheric haze (horizon band, softens LOD seams) */
	haze: 0,
	/** CSS3D cloud sprites (ArtsyClouds) + SVG cloud overlay */
	clouds: 1,
	/** Rain streaks */
	rain: 2,
	/** Lightning flashes */
	lightning: 2,
	/** Micro-events: birds, contrails, stars */
	microEvents: 3,
	/** Frost overlay (high-altitude) */
	frost: 5,
	/** Aircraft wing silhouette (shifts with bank angle) */
	wing: 7,
	/** Glass vignette darkening toward frame edges */
	glassVignette: 9,
	/** Outer vignette */
	vignette: 10,
	/** Inner glass-recess rim highlight */
	glassRecess: 11,
} as const;

export type ZLayer = keyof typeof Z;
