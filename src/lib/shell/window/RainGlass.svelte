<script lang="ts">
	/**
	 * RainGlass — real water beads on the window glass (CSS, not a shader).
	 *
	 * Why CSS instead of the Three.js near-plane shader it replaces: a water
	 * drop is a LENS — it refracts/magnifies whatever is behind it. A fragment
	 * shader on the transparent overlay can't cheaply sample the composited
	 * Cesium+Three scene behind itself, so it could only FAKE a bead with flat
	 * sprites. `backdrop-filter` blurs + brightens the LIVE scene behind each
	 * bead, so a STATIC drop looks alive — the world moves behind it and the
	 * bead magnifies different content frame to frame.
	 *
	 * Pi-5 budget: `backdrop-filter` is GPU-costly. Defaults:
	 *   - balanced/ultra: ~14 beads with live backdrop blur
	 *   - performance: ~7 beads, flat fill (no backdrop-filter) — default
	 *     qualityMode on ship. Mounted only while raining.
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { randomBetween } from '$lib/utils';
	import { createSeededRng, daySeed } from '$lib/world/prng';

	const model = useAeroWindow();
	const active = $derived(model.weather === 'rain' || model.weather === 'storm');
	const intensity = $derived(model.weather === 'storm' ? 1 : 0.72);
	const isPerf = $derived(model.config.world.qualityMode === 'performance');
	// Fewer beads on the Pi preset; slice a prebuilt pool so weather flips
	// don't reshuffle positions every frame.
	const beadCount = $derived(isPerf ? 7 : 14);

	// Organic, asymmetric blob — no two beads the same shape.
	const blob = (rng: () => number) => {
		const v = () => Math.round(randomBetween(38, 62, rng));
		return `${v()}% ${v()}% ${v()}% ${v()}% / ${v()}% ${v()}% ${v()}% ${v()}%`;
	};

	// Generate the full pool ONCE (plain const — not reactive).
	// ~1 in 4 is a "runner" that streaks down; the rest cling (stuck beads).
	// Seeded by the day so all 3 corridor panes lay out IDENTICAL beads —
	// Math.random would give each Pi a different pattern across the seam.
	const rng = createSeededRng(daySeed());
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
			radius: blob(rng),
		};
	});

	const beads = $derived(allBeads.slice(0, beadCount));
</script>

{#if active}
	<div
		class={['rain-glass', isPerf && 'flat']}
		style:--rg-intensity={intensity}
	>
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

<style>
	.rain-glass {
		position: absolute;
		inset: 0;
		pointer-events: none;
		border-radius: inherit;
		overflow: hidden;
		z-index: 9; /* over the scene, under the Glass rim-vignette (z:11) */
		opacity: var(--rg-intensity, 0.8);
		animation: rg-fade-in 1.2s ease-out;
	}

	@keyframes rg-fade-in {
		from { opacity: 0; }
	}

	.bead {
		position: absolute;
		width: var(--s);
		height: var(--s);
		/* The lens: blur + brighten the LIVE scene behind = real refraction. */
		backdrop-filter: blur(var(--blur)) brightness(1.14) saturate(1.08);
		-webkit-backdrop-filter: blur(var(--blur)) brightness(1.14) saturate(1.08);
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.07),
			rgba(255, 255, 255, 0) 60%
		);
		box-shadow:
			inset 1.5px 2px 3px rgba(255, 255, 255, 0.4),
			inset -2px -3px 5px rgba(0, 0, 0, 0.3),
			0 2px 4px rgba(0, 0, 0, 0.15);
		/* No permanent will-change — 14 promoted layers thrash memory on Pi. */
		animation: rg-bead var(--dur) ease-in-out var(--delay) infinite;
	}

	/* performance quality: same silhouette, no per-bead backdrop blur pass. */
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
	.rain-glass.flat .bead::after {
		filter: none;
		opacity: 0.55;
	}

	/* Roll-down trail */
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
		0%   { opacity: 0; transform: translateY(-2px) scale(0.6); }
		12%  { opacity: var(--o); transform: translateY(0) scale(1); }
		68%  { opacity: var(--o); transform: translateY(calc(var(--slide) * 0.12)); }
		100% { opacity: 0; transform: translateY(var(--slide)) scale(0.96); }
	}

	@media (prefers-reduced-motion: reduce) {
		.bead { animation: none; opacity: var(--o); }
		.rain-glass { animation: none; }
	}
</style>
