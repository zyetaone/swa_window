/**
 * Compositions barrel — authored recipes that drive how scene effects
 * distribute themselves and what the night palette looks like. Two flavours:
 *
 *   - Randomised compositions (clouds / lightning / microevents): the
 *     picker rolls one recipe per regime change so the same weather
 *     reads as a different sky each time.
 *   - Static palette (night): single authored table consumed by
 *     world/compose.ts for sky/light/VIIRS/warm-glow targets.
 *
 * Files:
 *   clouds.ts        — scattered / mackerel / solitary-giants / wall /
 *                      stratus-deck / tower (consumed by ArtsyClouds)
 *   lightning.ts     — sheet / forked / distant (consumed by Lightning)
 *   microevents.ts   — bird patterns (scattered / paired / flock) +
 *                      shooting-star patterns (dense / sparse-bright /
 *                      milky-way-band) consumed by MicroEventsEffect
 *   night.ts         — globe color, sky shifts, exposure, atmosphereLight,
 *                      VIIRS thresholds + cap, warm-glow peak — consumed
 *                      by world/compose.ts and shell/Pane.svelte
 */
export { CLOUD_COMPOSITIONS, pickCloudComposition, type CloudComposition } from './clouds';
export { LIGHTNING_COMPOSITIONS, pickLightningComposition, type LightningComposition, type LightningPattern } from './lightning';
export {
	BIRD_COMPOSITIONS,
	STAR_COMPOSITIONS,
	pickBirdComposition,
	pickStarComposition,
	type BirdComposition,
	type StarComposition,
	type BirdPattern,
	type StarPattern,
} from './microevents';
export { NIGHT_PALETTE } from './night';
