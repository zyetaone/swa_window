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
	 * bead magnifies different content frame to frame. The 3-D bead itself is
	 * the kevinbism "liquid-glass" recipe: an organic blob `border-radius`, an
	 * inset box-shadow (light top-left / dark bottom-right = refraction), and a
	 * `::before` specular highlight.
	 *
	 * Lives in the DOM glass layer, so it ships on BOTH render paths (Cesium-
	 * only fallback AND the hybrid) — unlike the overlay shader, which only
	 * existed when `useThreeOverlay` was on.
	 *
	 * Screen-local (water sits on THIS window's glass), so it does NOT need the
	 * 3-Pi seeded-determinism contract — three physical windows each having
	 * their own random beads is correct, not a seam to match.
	 *
	 * Pi-5 budget: `backdrop-filter` is GPU-costly, so this is a HANDFUL of
	 * large beads (~14), not a field — which is also how real window rain reads.
	 * Mounted only while it's actually raining (`{#if active}`), so the blur
	 * passes don't run in clear/cloudy weather (most of the time).
	 */
	import { useAeroWindow } from '$lib/model/aero-window.svelte';

	const model = useAeroWindow();
	const active = $derived(model.weather === 'rain' || model.weather === 'storm');
	const intensity = $derived(model.weather === 'storm' ? 1 : 0.72);

	const rand = (a: number, b: number) => a + Math.random() * (b - a);
	// Organic, asymmetric blob — no two beads the same shape.
	const blob = () => {
		const v = () => Math.round(rand(38, 62));
		return `${v()}% ${v()}% ${v()}% ${v()}% / ${v()}% ${v()}% ${v()}% ${v()}%`;
	};

	// Generate the beads ONCE (plain const — not reactive, never regenerates).
	// ~1 in 4 is a "runner" that streaks down; the rest cling (stuck beads).
	const beads = Array.from({ length: 14 }, () => {
		const runner = Math.random() < 0.25;
		return {
			x: rand(6, 94),
			y: rand(8, 86),
			size: rand(5, 14), // smaller, finer beads
			opacity: rand(0.5, 0.85),
			slide: runner ? rand(40, 130) : rand(2, 9),
			// Wet roll-down trail behind a runner (the streak it leaves as it
			// slides). Stuck beads leave none.
			trail: runner ? rand(28, 80) : 0,
			dur: rand(7, 15),
			delay: -rand(0, 12), // negative → beads start mid-cycle, desynced
			blur: rand(0.8, 1.7),
			radius: blob(),
		};
	});
</script>

{#if active}
	<div class="rain-glass" style:--rg-intensity={intensity}>
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
		/* 3-D bead — light refracts top-left, shades bottom-right; faint cast
		   shadow on the glass. A whisper of fill so the rim shadows read. */
		background: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.07),
			rgba(255, 255, 255, 0) 60%
		);
		box-shadow:
			inset 1.5px 2px 3px rgba(255, 255, 255, 0.4),
			inset -2px -3px 5px rgba(0, 0, 0, 0.3),
			0 2px 4px rgba(0, 0, 0, 0.15);
		will-change: transform, opacity;
		animation: rg-bead var(--dur) ease-in-out var(--delay) infinite;
	}

	/* Roll-down trail — a faint, blurred wet streak rising from the bead (the
	   path it leaves as it slides). Length = --trail (0 for stuck beads). */
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

	/* Specular highlight — the crisp glint near the bead's light side. */
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

	/* Grow in → cling (refracting) → slide a little → release + fade. Most beads
	   have a tiny --slide (they stick); runners have a large one (they streak). */
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
