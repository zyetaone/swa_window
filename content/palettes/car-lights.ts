/**
 * Car-lights palette — per-class RGBA byte tuples.
 *
 * Authored tuning for the Cesium-native car-lights effect. Consumed by
 * `lightColorBytes()` in scene/effects/car-lights/rules.ts.
 *
 * Distribution (set in scene/effects/car-lights/rules.ts:lightClass):
 *   70% 'white'  — headlights
 *   25% 'red'    — taillights
 *    5% 'blue'   — warm-yellow accent (type name historical; palette is
 *                   warm sodium amber, never emergency blue — aircraft
 *                   window aesthetic has no blue at altitude).
 */

export type LightClass = 'white' | 'red' | 'blue';

export const CAR_LIGHTS_PALETTE: Record<LightClass, [number, number, number, number]> = {
	white: [255, 230, 200, 220],
	red:   [255, 60, 40, 200],
	// Warm yellow (was cool blue). Aircraft-window aesthetic: all lights
	// from altitude read as warm sodium amber, never emergency blue.
	blue:  [255, 220, 150, 230],
};
