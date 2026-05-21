/**
 * Micro-event compositions — authored modes for the transient sky events
 * (birds, shooting stars, contrails).
 *
 * The existing MicroEventsEffect.svelte fires ONE event at a time with a
 * single {x, y} screen position. To stay scope-tight we don't change that
 * structural shape — instead each composition tunes how the picker
 * distributes successive events:
 *
 *   - Birds: 'paired' biases two consecutive bird events to nearby x; the
 *     screen reads as a small flock crossing. 'scattered' keeps the
 *     original uniform rand(10,90).
 *   - Shooting stars: 'dense' shortens the inter-event interval; the sky
 *     reads as an active meteor shower. 'sparse-bright' lengthens it.
 *     'milky-way-band' biases y to a narrow band so successive stars
 *     trace the band rather than splatter the sky.
 *   - Contrails: only direction varies, biased by current heading band.
 *
 * One composition per family is rolled at boot and re-rolled when the
 * underlying weather/sky regime changes (e.g. dawn → night).
 */

export type BirdPattern = 'scattered' | 'paired' | 'flock';
export type StarPattern = 'dense' | 'sparse-bright' | 'milky-way-band';

export interface BirdComposition {
	id: string;
	pattern: BirdPattern;
	/** When `paired` or `flock`, subsequent bird events bias toward the
	 * previous bird's x within this delta (% screen). */
	pairDelta: number;
	/** When `flock`, this many consecutive bird events are forced before
	 * the picker re-rolls anything else. */
	flockSize: number;
}

export interface StarComposition {
	id: string;
	pattern: StarPattern;
	/** Multiplier applied to model.config.atmosphere.microEvents.minInterval /
	 * maxInterval ONLY for shooting-star events. Smaller = more frequent. */
	intervalMul: number;
	/** Screen-y band for shooting stars. Default rand(10,40) is the upper
	 * sky; milky-way-band narrows this dramatically. */
	yRange: [number, number];
}

const BIRD_COMPOSITIONS: readonly BirdComposition[] = [
	{ id: 'scattered', pattern: 'scattered', pairDelta: 0, flockSize: 0 },
	{ id: 'paired',    pattern: 'paired',    pairDelta: 8, flockSize: 0 },
	{ id: 'flock',     pattern: 'flock',     pairDelta: 6, flockSize: 4 },
] as const;

const STAR_COMPOSITIONS: readonly StarComposition[] = [
	{ id: 'dense',           pattern: 'dense',           intervalMul: 0.45, yRange: [10, 40] },
	{ id: 'sparse-bright',   pattern: 'sparse-bright',   intervalMul: 1.8,  yRange: [12, 38] },
	{ id: 'milky-way-band',  pattern: 'milky-way-band',  intervalMul: 0.7,  yRange: [18, 26] },
] as const;

export { BIRD_COMPOSITIONS, STAR_COMPOSITIONS };

export function pickBirdComposition(): BirdComposition {
	return BIRD_COMPOSITIONS[Math.floor(Math.random() * BIRD_COMPOSITIONS.length)];
}

export function pickStarComposition(): StarComposition {
	return STAR_COMPOSITIONS[Math.floor(Math.random() * STAR_COMPOSITIONS.length)];
}
