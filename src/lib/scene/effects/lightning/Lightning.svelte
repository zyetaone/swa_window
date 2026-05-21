<script lang="ts">
	/**
	 * Lightning — self-contained strike timer + positional flash visual.
	 *
	 * Subscribes directly to the game-loop. Timer, position, and decay live
	 * in local $state — no coupling to AeroWindow beyond reading weather.
	 *
	 * Phase 11 — composition picker. When hasLightning flips false → true a
	 * new composition is rolled (sheet / forked / distant). intervalRange,
	 * intensityRange, x/y bands, and decay all come from the composition
	 * rather than the global weather config, so each storm session has its
	 * own character. The weather config's lightningMinInterval / Max /
	 * decayRate remain as a fallback when no composition is active (i.e.
	 * the hasLightning flag was true at boot).
	 */
	import { clamp, randomBetween } from '$lib/utils';
	import { subscribe } from '$lib/game-loop';
	import {
		pickLightningComposition,
		type LightningComposition,
	} from '$content/compositions/lightning';
	import type { EffectProps } from '$lib/scene/types';

	let { model }: EffectProps = $props();

	let intensity = $state(0);
	let x = $state(50);
	let y = $state(40);
	let composition = $state<LightningComposition | null>(null);

	let timer = 0;
	let nextStrike = 10;
	let prevHasLightning = false;

	$effect(() =>
		subscribe((delta: number) => {
			const wcfg = model.config.atmosphere.weather;
			const hasLightning = wcfg.hasLightning;

			// Roll a new composition each time a storm begins; clear it when
			// the storm ends so the next storm rolls fresh.
			if (hasLightning && !prevHasLightning) {
				composition = pickLightningComposition();
			} else if (!hasLightning && prevHasLightning) {
				composition = null;
			}
			prevHasLightning = hasLightning;

			if (!hasLightning) {
				intensity = 0;
				return;
			}

			const c = composition;
			const decayRate = c?.decayRate ?? wcfg.lightningDecayRate;

			timer += delta;
			if (intensity > 0) {
				intensity = clamp(intensity - delta * decayRate, 0, 1);
			}
			if (intensity < 0.01 && timer > nextStrike) {
				if (c) {
					intensity = randomBetween(c.intensityRange[0], c.intensityRange[1]);
					x = randomBetween(c.xRange[0], c.xRange[1]);
					y = randomBetween(c.yRange[0], c.yRange[1]);
					nextStrike = randomBetween(c.intervalRange[0], c.intervalRange[1]);
				} else {
					intensity = randomBetween(0.5, 1);
					x = randomBetween(20, 80);
					y = randomBetween(15, 65);
					nextStrike = randomBetween(wcfg.lightningMinInterval, wcfg.lightningMaxInterval);
				}
				timer = 0;
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
