/**
 * Z-layer ordering — single source of truth.
 *
 * Previously triplicated: registry.ts inline z:N values, Weather.svelte
 * hardcoded z-index, Pane.svelte doc-comment table, CLAUDE.md table.
 * They had already drifted (CLAUDE.md documented z:3 micro-events and
 * z:11 glass-recess which Pane.svelte's comment omitted).
 *
 * Every call site — effect registry, Weather.svelte, Pane.svelte,
 * atmosphere/*, scene/effects/* — imports from here.
 */

export const Z = {
	/** Cesium canvas — terrain, buildings, NASA VIIRS night lights */
	cesium: 0,
	/** Geo-positioned effects (car-lights). Renders inside Cesium; value inert */
	geo: 0,
	/** CSS3D cloud sprites (ArtsyClouds) — Phase 10: moved BEHIND haze per user
	 *  direction "move clouds to bg". Now sits between Cesium and haze, reading
	 *  as a deep background layer rather than a midground overlay. */
	clouds: 0,
	/** Atmospheric haze (horizon band, softens LOD seams) — now on TOP of clouds */
	haze: 1,
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
