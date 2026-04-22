/**
 * scene-state.svelte.ts — SSOT for the /playground2 layer-by-layer
 * build. All six grid cells share this state. Drive it from one
 * control and every cell updates in lockstep so you can compare
 * layer contributions side by side.
 *
 * Kept deliberately tiny at start — we'll grow fields as each layer
 * lands. Each commit adds only what that layer needs.
 */

import * as THREE from 'three';

/** World-wide defaults; overrides picked up live from the drawer. */
export const sceneState = $state({
	/** Hours 0–24, float. Drives sun direction + sky phase. */
	timeOfDay: 10,

	/** Location on Earth — starting at Dubai like the prod. */
	lat: 25.2,
	lon: 55.3,

	/** Camera altitude in meters above sea level. */
	altitudeMeters: 9000,

	/** Camera heading in degrees (0 = north, 90 = east). */
	headingDeg: 90,

	/** View pitch in degrees (0 = horizontal, +down). */
	pitchDeg: 12,

	/** Which grid cells are on. Letting us toggle individual layers
	 * during debug even though the default is "all six visible". */
	showGrid: [true, true, true, true, true, true] as [boolean, boolean, boolean, boolean, boolean, boolean],
});

/**
 * Compute sun direction in world space for the current state. For
 * grid-1 (sky) this is enough; later layers can compute their own
 * scattering-aware version via takram/three-atmosphere.
 */
export function getSunDirection(): THREE.Vector3 {
	// Simple day-arc approximation. takram provides getSunDirectionECEF
	// for a real Date → ECEF vector; we'll swap to that in commit 2
	// when the atmosphere lands.
	const hourAngle = ((sceneState.timeOfDay - 12) / 12) * Math.PI;
	const latRad = (sceneState.lat * Math.PI) / 180;
	const decl = 0; // equinox approximation; good enough for grid-0
	const x = Math.cos(decl) * Math.sin(hourAngle);
	const y = Math.sin(decl) * Math.cos(latRad) - Math.cos(decl) * Math.sin(latRad) * Math.cos(hourAngle);
	const z = Math.sin(decl) * Math.sin(latRad) + Math.cos(decl) * Math.cos(latRad) * Math.cos(hourAngle);
	return new THREE.Vector3(x, y, z).normalize();
}

/** Cell labels for the grid — also drives what that cell renders. */
export const GRID_LAYERS = [
	{ id: 'sky',       label: '1 · Sky & Atmosphere',  caption: 'Bruneton scattering, sun from date' },
	{ id: 'terrain',   label: '2 · + Terrain',          caption: 'Sentinel-2 texture on Terrarium DEM' },
	{ id: 'water',     label: '3 · + Water',            caption: 'Animated normals + specular + shore ripple' },
	{ id: 'buildings', label: '4 · + Buildings',        caption: 'OSM extrusions' },
	{ id: 'clouds',    label: '5 · + Clouds',           caption: 'Volumetric raymarch' },
	{ id: 'postfx',    label: '6 · + Post-FX',          caption: 'Bloom + lens flare + AgX tonemap' },
] as const;

export type GridLayerId = (typeof GRID_LAYERS)[number]['id'];

/**
 * For a given grid cell, return the cumulative set of layers that
 * should be rendered. Cell 1 = just sky; cell 6 = everything.
 */
export function layersFor(cellIdx: number): Set<GridLayerId> {
	const set = new Set<GridLayerId>();
	for (let i = 0; i <= cellIdx && i < GRID_LAYERS.length; i++) {
		set.add(GRID_LAYERS[i].id);
	}
	return set;
}
