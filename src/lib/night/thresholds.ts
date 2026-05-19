/**
 * Time-of-day thresholds for the night/dawn/dusk rendering pipeline.
 *
 * Single source of truth for the hour boundaries used by:
 *   - utils.getSkyState        (categorical sky state)
 *   - utils.nightFactor        (0..1 darkness)
 *   - utils.dawnDuskFactor     (0..1 transition peak)
 *   - world/compose.ts         (isSunVisible, Cesium sun disc)
 *
 * Editing one value here keeps all four consumers aligned automatically.
 * All values are decimal hours in local time (same space as model.timeOfDay).
 */
export const T = {
	/** Night ends; dawn transition begins. */
	DAWN_START:  5,
	/** Dawn ends; full daylight. */
	DAY_START:   7,
	/** Full daylight ends; dusk transition begins. */
	DAY_END:    18,
	/** Dusk ends; night begins (blue hour is included in dusk). */
	DUSK_END:   21,
	/** dawnDusk factors reach zero; nightFactor reaches one. */
	DEEP_NIGHT: 22,
} as const;
