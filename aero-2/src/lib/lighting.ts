/**
 * Time-of-day → nightFactor. √-curve dusk/dawn ramp (v1 parity).
 */

export const TIME_THRESHOLDS = {
	DAWN_START: 5,
	DAY_START: 7,
	DAY_END: 18,
	DEEP_NIGHT: 21,
} as const;

export class NightLighting {
	/** 0 = full day, 1 = full night. */
	factor(timeOfDay: number): number {
		const T = TIME_THRESHOLDS;
		if (timeOfDay >= T.DAY_START && timeOfDay <= T.DAY_END) return 0;
		if (timeOfDay < T.DAWN_START || timeOfDay > T.DEEP_NIGHT) return 1;
		if (timeOfDay < T.DAY_START) {
			const tDawn = (timeOfDay - T.DAWN_START) / (T.DAY_START - T.DAWN_START);
			return Math.sqrt(1 - tDawn);
		}
		const tDusk = (timeOfDay - T.DAY_END) / (T.DEEP_NIGHT - T.DAY_END);
		return Math.sqrt(tDusk);
	}
}

export const nightLighting = new NightLighting();
