<script lang="ts">
	/**
	 * RainGlass — real water droplets on the window glass with live backdrop refraction,
	 * condensation frost, and storm lightning flash.
	 */
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	const active = $derived(display.config.weather === 'rain' || display.config.weather === 'storm');
	const intensity = $derived(display.config.weather === 'storm' ? 1 : 0.72);
	const isPerf = $derived(display.config.qualityMode === 'performance');
	const beadCount = $derived(isPerf ? 7 : 14);

	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const rng = mulberry32(104729);
	function randomBetween(min: number, max: number, r: () => number): number {
		return min + r() * (max - min);
	}

	const blob = (r: () => number) => {
		const v = () => Math.round(randomBetween(38, 62, r));
		return `${v()}% ${v()}% ${v()}% ${v()}% / ${v()}% ${v()}% ${v()}% ${v()}%`;
	};

	const allBeads = Array.from({ length: 14 }, () => {
		const runner = rng() < 0.25;
		return {
			x: randomBetween(6, 94, rng),
			y: randomBetween(8, 86, rng),
			size: randomBetween(5, 14, rng),
			opacity: randomBetween(0.5, 0.85, rng),
			slide: runner ? randomBetween(40, 130, rng) : randomBetween(2, 9, rng),
			trail: runner ? randomBetween(28, 80, rng) : 0,
			dur: randomBetween(7, 15, rng),
			delay: -randomBetween(0, 12, rng),
			blur: randomBetween(0.8, 1.7, rng),
			radius: blob(rng)
		};
	});

	const beads = $derived(allBeads.slice(0, beadCount));

	// Storm lightning flash generator
	let lightning = $state(false);
	$effect(() => {
		if (display.config.weather !== 'storm') return;
		let timeout: ReturnType<typeof setTimeout>;
		const scheduleFlash = () => {
			const delay = 4000 + Math.random() * 9000;
			timeout = setTimeout(() => {
				lightning = true;
				setTimeout(() => {
					lightning = false;
					scheduleFlash();
				}, 120);
			}, delay);
		};
		scheduleFlash();
		return () => clearTimeout(timeout);
	});
</script>

{#if active}
	<div class={['rain-glass', isPerf && 'flat']} style:--rg-intensity={intensity}>
		{#each beads as b, i (i)}
			<span
				class="bead"
				style:left="{b.x}%"
				style:top="{b.y}%"
				style:--s="{b.size}px"
				style:--o={b.opacity}
				style:--slide="{b.slide}px"
				style:--dur="{b.dur}s"
				style:--delay="{b.delay}s"
				style:--blur="{b.blur}px"
				style:--trail="{b.trail}px"
				style:border-radius={b.radius}
			></span>
		{/each}
	</div>
{/if}

{#if lightning}
	<div class="lightning-flash" aria-hidden="true"></div>
{/if}

<style>
	.rain-glass {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		overflow: hidden;
		z-index: 9;
		opacity: var(--rg-intensity, 0.8);
		animation: rg-fade-in 1.2s ease-out;
	}

	@keyframes rg-fade-in {
		from {
			opacity: 0;
		}
	}

	.bead {
		position: absolute;
		width: var(--s);
		height: var(--s);
		backdrop-filter: blur(var(--blur)) brightness(1.14) saturate(1.08);
		-webkit-backdrop-filter: blur(var(--blur)) brightness(1.14) saturate(1.08);
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0) 60%);
		box-shadow:
			inset 1.5px 2px 3px rgba(255, 255, 255, 0.4),
			inset -2px -3px 5px rgba(0, 0, 0, 0.3),
			0 2px 4px rgba(0, 0, 0, 0.15);
		animation: rg-bead var(--dur) ease-in-out var(--delay) infinite;
	}

	.rain-glass.flat .bead {
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		background: linear-gradient(
			135deg,
			rgba(220, 235, 255, 0.22),
			rgba(180, 200, 230, 0.08) 55%,
			rgba(255, 255, 255, 0.04)
		);
	}

	.bead::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 55%;
		width: 32%;
		height: var(--trail, 0px);
		transform: translateX(-50%);
		border-radius: 50% 50% 42% 42%;
		background: linear-gradient(
			to top,
			rgba(210, 225, 255, 0.16),
			rgba(210, 225, 255, 0.04) 55%,
			transparent
		);
		filter: blur(1.5px);
	}

	.bead::before {
		content: '';
		position: absolute;
		top: 16%;
		left: 20%;
		width: 30%;
		height: 30%;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.92), transparent 70%);
	}

	@keyframes rg-bead {
		0% {
			opacity: 0;
			transform: translateY(-2px) scale(0.6);
		}
		12% {
			opacity: var(--o);
			transform: translateY(0) scale(1);
		}
		68% {
			opacity: var(--o);
			transform: translateY(calc(var(--slide) * 0.12));
		}
		100% {
			opacity: 0;
			transform: translateY(var(--slide)) scale(0.96);
		}
	}

	.lightning-flash {
		position: absolute;
		inset: 0;
		background: rgba(235, 245, 255, 0.45);
		pointer-events: none;
		z-index: 15;
		animation: flash 0.12s ease-out;
	}

	@keyframes flash {
		0% {
			opacity: 0;
		}
		30% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}
</style>
