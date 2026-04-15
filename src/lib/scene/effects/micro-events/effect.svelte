<script lang="ts">
	/**
	 * Micro-events — bird, shooting star, contrail.
	 * Schedules transient events based on conditions (altitude, sky, weather).
	 * Self-contained timer + event state; uses existing MicroEvent.svelte for visuals.
	 */
	import { MICRO_EVENTS } from '$lib/constants';
	import { randomBetween, pickRandom } from '$lib/utils';
	import { subscribe } from '$lib/game-loop';
	import type { MicroEventData } from '$lib/types';
	import MicroEvent from '$lib/ui/MicroEvent.svelte';
	import type { EffectProps } from '../../types';

	let { model }: EffectProps = $props();

	let event = $state<MicroEventData | null>(null);

	// Private timers
	let timer = 0;
	let timeToNext = randomBetween(MICRO_EVENTS.MIN_INTERVAL, MICRO_EVENTS.MAX_INTERVAL);

	$effect(() =>
		subscribe((delta: number) => {
			// Advance active event
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

			// Schedule next event
			timer += delta;
			if (timer < timeToNext) return;
			timer = 0;
			timeToNext = randomBetween(MICRO_EVENTS.MIN_INTERVAL, MICRO_EVENTS.MAX_INTERVAL);

			const types: Array<'bird' | 'shooting-star' | 'contrail'> = [];
			const altitude = model.flight.altitude;
			const sky = model.skyState;
			const density = model.cloudDensity;
			const weather = model.weather;

			if (altitude < 15000 && sky === 'day' && weather !== 'rain' && weather !== 'overcast') {
				types.push('bird');
			}
			if (sky === 'night' && density < 0.5) {
				types.push('shooting-star');
			}
			if (sky === 'day' && altitude > 20000 && density < 0.8) {
				types.push('contrail');
			}
			if (types.length === 0) return;

			const type = pickRandom(types);
			const duration =
				type === 'bird' ? MICRO_EVENTS.BIRD_DURATION
				: type === 'shooting-star' ? MICRO_EVENTS.SHOOTING_STAR_DURATION
				: MICRO_EVENTS.CONTRAIL_DURATION;

			event = {
				type,
				duration,
				elapsed: 0,
				x: randomBetween(10, 90),
				y: type === 'bird' ? randomBetween(20, 80) : randomBetween(10, 40),
			};
		}),
	);
</script>

<MicroEvent {event} />
