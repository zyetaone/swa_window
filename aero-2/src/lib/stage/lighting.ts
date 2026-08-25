/**
 * Time-of-day lighting curves: dusk, dawn, deep night.
 */

export const DAYLIGHT_THRESHOLDS = {
	DAWN_START: 5.5,
	DAY_START: 7.0,
	DAY_END: 19.0,
	DEEP_NIGHT: 20.5
} as const;

export function nightFactor(timeOfDay: number): number {
	const t = ((timeOfDay % 24) + 24) % 24;
	const T = DAYLIGHT_THRESHOLDS;

	if (t >= T.DAY_START && t <= T.DAY_END) return 0;
	if (t >= T.DEEP_NIGHT || t <= T.DAWN_START) return 1;

	if (t > T.DAWN_START && t < T.DAY_START) {
		const tDawn = (T.DAY_START - t) / (T.DAY_START - T.DAWN_START);
		return Math.sqrt(tDawn);
	}

	const tDusk = (t - T.DAY_END) / (T.DEEP_NIGHT - T.DAY_END);
	return Math.sqrt(tDusk);
}

export const nightLighting = { factor: nightFactor };
