<script lang="ts">
	/**
	 * Lightning — self-contained strike timer + positional flash visual.
	 *
	 * Subscribes directly to the game-loop. Timer, position, and decay live
	 * in local $state — no coupling to WindowModel beyond reading weather.
	 */
	import { AIRCRAFT, WEATHER_EFFECTS } from '$lib/constants';
	import { clamp, randomBetween } from '$lib/utils';
	import { subscribe } from '$lib/game-loop';
	import type { EffectProps } from '$lib/scene/types';

	let { model }: EffectProps = $props();

	// Reactive outputs — rendered below
	let intensity = $state(0);
	let x = $state(50);
	let y = $state(40);

	// Private timers — not reactive (read/written inside the game-loop callback only)
	let timer = 0;
	let nextStrike = randomBetween(AIRCRAFT.LIGHTNING_MIN_INTERVAL, AIRCRAFT.LIGHTNING_MAX_INTERVAL);

	$effect(() =>
		subscribe((delta: number) => {
			const hasLightning = WEATHER_EFFECTS[model.weather].hasLightning;
			if (!hasLightning) {
				intensity = 0;
				return;
			}

			timer += delta;
			if (intensity > 0) {
				intensity = clamp(intensity - delta * AIRCRAFT.LIGHTNING_DECAY_RATE, 0, 1);
			}
			if (intensity < 0.01 && timer > nextStrike) {
				intensity = randomBetween(0.5, 1);
				x = randomBetween(20, 80);
				y = randomBetween(15, 65);
				timer = 0;
				nextStrike = randomBetween(
					AIRCRAFT.LIGHTNING_MIN_INTERVAL,
					AIRCRAFT.LIGHTNING_MAX_INTERVAL,
				);
			}
		}),
	);

	const opacity = $derived(intensity * 0.3);
</script>

{#if opacity > 0}
	<div
		class="lightning-flash"
		style:opacity
		style:--lx="{x}%"
		style:--ly="{y}%"
	></div>
{/if}

<style>
	.lightning-flash {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 60% 50% at var(--lx) var(--ly),
			rgba(200, 200, 255, 1) 0%,
			rgba(180, 180, 255, 0.6) 30%,
			rgba(150, 150, 230, 0.2) 60%,
			transparent 85%
		);
		mix-blend-mode: screen;
		transition: opacity 0.05s linear;
	}
</style>
