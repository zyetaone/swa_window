<script lang="ts">
	/**
	 * Micro-events — bird, shooting star, contrail.
	 * Schedules transient events based on conditions (altitude, sky, weather).
	 * Self-contained timer + event state; uses existing MicroEvent.svelte for visuals.
	 *
	 * Phase 5 migration: MICRO_EVENTS constants → model.config.atmosphere.microEvents.*.
	 */
	import { randomBetween, pickRandom } from '$lib/utils';
	import { subscribe } from '$lib/game-loop';
	import type { MicroEventData } from '$lib/types';
	import MicroEvent from './MicroEvent.svelte';
	import type { EffectProps } from '$lib/scene/types';

	let { model }: EffectProps = $props();

	let event = $state<MicroEventData | null>(null);

	let timer = 0;
	let timeToNext = 100;

	$effect(() => {
		const me = model.config.atmosphere.microEvents;
		timeToNext = randomBetween(me.minInterval, me.maxInterval);
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
			timeToNext = randomBetween(me.minInterval, me.maxInterval);

			const types: Array<'bird' | 'shooting-star' | 'contrail'> = [];
			const altitude = model.flight.altitude;
			const sky = model.skyState;
			const density = model.config.atmosphere.clouds.density;
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
				type === 'bird' ? me.birdDuration
				: type === 'shooting-star' ? me.shootingStarDuration
				: me.contrailDuration;

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
