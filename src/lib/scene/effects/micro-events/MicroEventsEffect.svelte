<script lang="ts">
	/**
	 * Micro-events — bird, shooting star, contrail.
	 *
	 * Phase 5: timing reads from model.config.atmosphere.microEvents.*.
	 * Phase 11: bird + star compositions in $content/compositions/microevents
	 * tune how successive events are distributed (paired birds, flocks,
	 * dense meteor showers, milky-way-band stars). Compositions are
	 * re-rolled when the underlying regime changes (skyState transition).
	 */
	import { randomBetween, pickRandom } from '$lib/utils';
	import { subscribe } from '$lib/game-loop';
	import type { MicroEventData } from '$lib/types';
	import MicroEvent from './MicroEvent.svelte';
	import type { EffectProps } from '$lib/scene/types';
	import {
		pickBirdComposition,
		pickStarComposition,
		type BirdComposition,
		type StarComposition,
	} from '$content/compositions/microevents';

	let { model }: EffectProps = $props();

	let event = $state<MicroEventData | null>(null);
	let birds = $state<BirdComposition>(pickBirdComposition());
	let stars = $state<StarComposition>(pickStarComposition());

	let timer = 0;
	let timeToNext = 100;
	// Flock state — when birds.flockSize > 0, this counts down forced-bird
	// events. Last bird x is remembered for paired/flock x-bias.
	let flockRemaining = 0;
	let lastBirdX = 50;

	$effect(() => {
		const me = model.config.atmosphere.microEvents;
		timeToNext = randomBetween(me.minInterval, me.maxInterval);
	});

	// Re-roll compositions on sky-state transition (dawn → day → dusk → night).
	$effect(() => {
		void model.skyState;
		birds = pickBirdComposition();
		stars = pickStarComposition();
	});

	$effect(() =>
		subscribe((delta: number) => {
			if (event) {
				const elapsed = event.elapsed + delta;
				if (elapsed >= event.duration) {
					timer = 0;
					event = null;
				} else {
					event = { ...event, elapsed };
				}
				return;
			}

			const me = model.config.atmosphere.microEvents;

			timer += delta;
			if (timer < timeToNext) return;
			timer = 0;

			const types: Array<'bird' | 'shooting-star' | 'contrail'> = [];
			const altitude = model.flight.altitude;
			const sky = model.skyState;
			const density = model.config.atmosphere.clouds.density;
			const weather = model.weather;

			if (altitude < 15000 && sky === 'day' && weather !== 'rain' && weather !== 'overcast') {
				types.push('bird');
			}
			// Skip DOM shooting-stars when the Three overlay is on — its Meteors
			// own that (and NightStars the static field). Birds/contrails stay.
			if (sky === 'night' && density < 0.5 && !model.config.world.useThreeOverlay) {
				types.push('shooting-star');
			}
			if (sky === 'day' && altitude > 20000 && density < 0.8) {
				types.push('contrail');
			}
			if (types.length === 0) {
				timeToNext = randomBetween(me.minInterval, me.maxInterval);
				return;
			}

			// Flock override — force consecutive bird events when the bird
			// composition says so. Decrements per fired bird; falls through
			// to normal picker once exhausted.
			let type: 'bird' | 'shooting-star' | 'contrail';
			if (flockRemaining > 0 && types.includes('bird')) {
				type = 'bird';
				flockRemaining -= 1;
			} else {
				type = pickRandom(types);
				if (type === 'bird' && birds.pattern === 'flock' && birds.flockSize > 0) {
					flockRemaining = birds.flockSize - 1;
				}
			}

			const duration =
				type === 'bird' ? me.birdDuration
				: type === 'shooting-star' ? me.shootingStarDuration
				: me.contrailDuration;

			// Position rules per composition.
			let x: number, y: number;
			if (type === 'bird') {
				if (birds.pairDelta > 0 && (birds.pattern === 'paired' || birds.pattern === 'flock')) {
					x = Math.max(5, Math.min(95, lastBirdX + randomBetween(-birds.pairDelta, birds.pairDelta)));
				} else {
					x = randomBetween(10, 90);
				}
				y = randomBetween(20, 80);
				lastBirdX = x;
			} else if (type === 'shooting-star') {
				x = randomBetween(10, 90);
				y = randomBetween(stars.yRange[0], stars.yRange[1]);
			} else {
				x = randomBetween(10, 90);
				y = randomBetween(10, 40);
			}

			// Star composition's interval multiplier — only applied when the
			// NEXT event is a shooting star regime (sky is night + low density).
			const isStarRegime = sky === 'night' && density < 0.5;
			const intervalMul = isStarRegime ? stars.intervalMul : 1;
			timeToNext = randomBetween(me.minInterval * intervalMul, me.maxInterval * intervalMul);

			event = { type, duration, elapsed: 0, x, y };
		}),
	);
</script>

<MicroEvent {event} />
