/**
 * Compositions barrel — authored randomised recipes that vary how scene
 * effects distribute themselves across moods. See per-family files for
 * the actual recipes.
 *
 * Files:
 *   clouds.ts        — scattered / mackerel / solitary-giants / wall /
 *                      stratus-deck / tower (consumed by ArtsyClouds)
 *   lightning.ts     — sheet / forked / distant (consumed by Lightning)
 *   microevents.ts   — bird patterns (scattered / paired / flock) +
 *                      shooting-star patterns (dense / sparse-bright /
 *                      milky-way-band) consumed by MicroEventsEffect
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
