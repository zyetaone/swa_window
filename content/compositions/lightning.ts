/**
 * Lightning compositions — authored storm characters.
 *
 * Three patterns:
 *   sheet   — broad full-frame flashes high in the sky, longer decay,
 *             evenly distributed x. The "summer storm five miles away".
 *   forked  — narrow intense strikes, mid-frame y, shorter decay. The
 *             "lightning hits the building you're looking at".
 *   distant — low-y dim flashes near the horizon line, very long decay
 *             so it reads as the storm cell IS the horizon. The "still
 *             watching the storm from the air after passing it".
 *
 * The picker rolls one composition when storm weather begins; it doesn't
 * mix patterns within a storm (real cells have one character).
 */

export type LightningPattern = 'sheet' | 'forked' | 'distant';

export interface LightningComposition {
	id: string;
	pattern: LightningPattern;
	/** Time between strikes (seconds). Smaller = busier storm. */
	intervalRange: [number, number];
	/** Peak intensity per strike (0..1). Tracks Lightning.svelte's intensity. */
	intensityRange: [number, number];
	/** Screen-y band for strike center (% from top). */
	yRange: [number, number];
	/** Screen-x band for strike center. */
	xRange: [number, number];
	/** Decay rate — higher = strike fades faster. Lightning.svelte uses
	 * config.weather.lightningDecayRate; this composition overrides it. */
	decayRate: number;
}

const COMPOSITIONS: readonly LightningComposition[] = [
	{
		id: 'sheet',
		pattern: 'sheet',
		intervalRange: [4, 9],
		intensityRange: [0.4, 0.7],
		yRange: [10, 30],
		xRange: [15, 85],
		decayRate: 2.2,
	},
	{
		id: 'forked',
		pattern: 'forked',
		intervalRange: [2, 6],
		intensityRange: [0.7, 1.0],
		yRange: [25, 55],
		xRange: [20, 80],
		decayRate: 4.5,
	},
	{
		id: 'distant',
		pattern: 'distant',
		intervalRange: [6, 14],
		intensityRange: [0.25, 0.45],
		yRange: [45, 62],
		xRange: [5, 95],
		decayRate: 1.4,
	},
] as const;

export const LIGHTNING_COMPOSITIONS = COMPOSITIONS;

/**
 * Pick a lightning composition at storm start. Re-roll when hasLightning
 * flips from false → true so each storm session has one character.
 */
export function pickLightningComposition(): LightningComposition {
	return COMPOSITIONS[Math.floor(Math.random() * COMPOSITIONS.length)];
}
