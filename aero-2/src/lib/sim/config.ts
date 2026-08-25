/**
 * Tuning knobs read imperatively each tick.
 */

export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;
export const DEFAULT_PITCH_DEG = -18;

export const ORBIT = {
	driftRate: 3.42e-4,
	majorMin: 0.08,
	majorMax: 0.25,
	breathePeriod: 180,
	flightSpeed: 6.0
} as const;

export const HILLSHADE_DEFAULT = 0.35;
export const HILLSHADE_SHADOW_COLOR = '#1a2436';
export const TERRAIN_EXAGGERATION = 1;
