/**
 * The shared contract: what one pane of the window is showing, plus the tuning
 * numbers that answer it.
 *
 * This module is the BASE of the dependency graph and **imports nothing but
 * `locations.ts`**. That is the whole point of it existing.
 *
 * `WindowParams` used to live in `sim/`, which every other folder needs — so
 * `flight/` and `stage/` imported from `sim/` while `sim/` imported from them,
 * a genuine cycle in both directions. A shared contract that everything reads
 * cannot live in a layer that reads everything. It lives here instead, at the
 * bottom, where nothing can point back down at.
 */

import { Location } from '#lib/config/locations.js';

// ── The contract ──────────────────────────────────────────────────────────────

/**
 * One pane of the window, fully described.
 *
 * On a three-Pi wall these are identical across machines EXCEPT `azimuthDeg`:
 * one aircraft, one clock, one atmosphere, three view directions whose frusta
 * tile into a single continuous window.
 */
export interface WindowParams {
	readonly place: Location;
	/** Where this pane looks, relative to the aircraft's track. */
	readonly azimuthDeg: number;
	/** Depression below the horizon. Negative looks down. */
	readonly pitchDeg: number;
	/** Opacity of the US-only detail imagery, 0..1. 0 unmounts the layer. */
	readonly detail: number;
	/** Climb envelope, metres above ground. */
	readonly floorM: number;
	readonly ceilingM: number;
	/** Hillshade exaggeration. */
	readonly shade: number;
}

// ── Camera ────────────────────────────────────────────────────────────────────

/**
 * 0 would be the windscreen. A passenger window is roughly perpendicular, so
 * the default looks out of the left side.
 */
export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;

export const DEFAULT_PITCH_DEG = -18;

// ── Flight ────────────────────────────────────────────────────────────────────

/**
 * ~6 min per orbit. See `orbitRate()` in `flight/rules.ts`:
 * `rate = driftRate * flightSpeed / meanRadius`.
 */
export const ORBIT = {
	driftRate: 3.42e-4,
	majorMin: 0.08,
	majorMax: 0.25,
	breathePeriod: 180,
	flightSpeed: 6.0
} as const;

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

// ── Ground ────────────────────────────────────────────────────────────────────

/**
 * Hillshade strength. Free structure — it comes off the DEM already fetched for
 * the terrain mesh, and it closed the perceived-sharpness gap that ~55x more
 * imagery resolution was supposed to be needed for. See ADR-005.
 */
export const HILLSHADE_DEFAULT = 0.35;

export const HILLSHADE_SHADOW_COLOR = '#1a2436';

/** Terrain displacement multiplier. 1 = true to life. */
export const TERRAIN_EXAGGERATION = 1;

// ── Cabin ─────────────────────────────────────────────────────────────────────

/** Past this, the blind is considered down and passenger chrome hides. */
export const BLIND_HUD_THRESHOLD = 0.5;
