<script lang="ts">
	/**
	 * CloudBlobs — SVG feTurbulence clouds with perspective + time seed
	 *
	 * Tuned iteration:
	 *   - More clouds (12 total across 3 layers)
	 *   - Near clouds much bigger
	 *   - Slower overall drift (calming)
	 *   - More blur on far, less on near
	 *   - Steeper perspective tilt
	 *   - Band positioned lower (more terrain visible above)
	 *   - Dense/opaque at horizon, wispy/transparent near window
	 */

	interface Props {
		density?: number;
		nightFactor?: number;
		dawnDuskFactor?: number;
		speed?: number;
		time?: number;
	}

	let {
		density = 0.5,
		nightFactor = 0,
		dawnDuskFactor = 0,
		speed = 1.0,
		time = 0,
	}: Props = $props();

	const seedEpoch = $derived(Math.floor(time / 90));

	// FAR (horizon): small, dense, very slow, heavy blur
	const far = [
		{ id: 0, seed: 42,  top: 2,  left: -5,  w: 250, h: 90,  dur: 160, delay: -10 },
		{ id: 1, seed: 137, top: 10, left: 20,  w: 220, h: 80,  dur: 180, delay: -50 },
		{ id: 2, seed: 271, top: 5,  left: 45,  w: 280, h: 100, dur: 150, delay: -80 },
		{ id: 3, seed: 389, top: 12, left: 70,  w: 240, h: 85,  dur: 170, delay: -30 },
		{ id: 4, seed: 503, top: 8,  left: 92,  w: 260, h: 95,  dur: 155, delay: -65 },
	];

	// MID: medium
	const mid = [
		{ id: 5, seed: 619, top: 28, left: -10, w: 380, h: 150, dur: 100, delay: -15 },
		{ id: 6, seed: 743, top: 35, left: 25,  w: 350, h: 130, dur: 110, delay: -45 },
		{ id: 7, seed: 857, top: 30, left: 55,  w: 400, h: 140, dur: 95,  delay: -70 },
		{ id: 8, seed: 967, top: 38, left: 80,  w: 360, h: 135, dur: 105, delay: -25 },
	];

	// NEAR (foreground): big, wispy, fast, minimal blur
	const near = [
		{ id: 9,  seed: 1087, top: 55, left: -20, w: 600, h: 240, dur: 65, delay: -10 },
		{ id: 10, seed: 1213, top: 65, left: 30,  w: 550, h: 220, dur: 55, delay: -35 },
		{ id: 11, seed: 1337, top: 58, left: 65,  w: 650, h: 260, dur: 70, delay: -55 },
	];

	const seeds = $derived([...far, ...mid, ...near].map(c => c.seed + seedEpoch));

	const rgb = $derived.by(() => {
		if (nightFactor > 0.7) return '180,190,215';
		if (dawnDuskFactor > 0.3) return '255,230,195';
		return '255,255,255';
	});

	const spd = $derived(Math.max(speed, 0.2));
</script>

<svg width="0" height="0" aria-hidden="true">
	<!-- Far: high octaves, strong displacement, very blurred -->
	{#each far as c, i (c.id)}
		<filter id="cf-{c.id}" x="-30%" y="-30%" width="160%" height="160%">
			<feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="4" seed={seeds[i]} />
			<feDisplacementMap in="SourceGraphic" scale="70" />
			<feGaussianBlur stdDeviation="16" />
		</filter>
	{/each}
	<!-- Mid -->
	{#each mid as c, i (c.id)}
		<filter id="cf-{c.id}" x="-30%" y="-30%" width="160%" height="160%">
			<feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="3" seed={seeds[far.length + i]} />
			<feDisplacementMap in="SourceGraphic" scale="60" />
			<feGaussianBlur stdDeviation="10" />
		</filter>
	{/each}
	<!-- Near: low octaves, light displacement, minimal SVG blur (CSS blur handles it) -->
	{#each near as c, i (c.id)}
		<filter id="cf-{c.id}" x="-30%" y="-30%" width="160%" height="160%">
			<feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed={seeds[far.length + mid.length + i]} />
			<feDisplacementMap in="SourceGraphic" scale="50" />
			<feGaussianBlur stdDeviation="6" />
		</filter>
	{/each}
</svg>

{#if density > 0.01}
	<div class="deck">
		{#each far as c (c.id)}
			<div
				class="cloud"
				style:top="{c.top}%"
				style:left="{c.left}%"
				style:width="{c.w * (0.5 + density * 0.7)}px"
				style:height="{c.h * (0.5 + density * 0.7)}px"
				style:filter="url(#cf-{c.id}) blur(10px)"
				style:opacity={0.65 * density}
				style:background="rgba({rgb}, 0.9)"
				style:animation-duration="{c.dur / spd}s"
				style:animation-delay="{c.delay}s"
			></div>
		{/each}

		{#each mid as c (c.id)}
			<div
				class="cloud"
				style:top="{c.top}%"
				style:left="{c.left}%"
				style:width="{c.w * (0.5 + density * 0.7)}px"
				style:height="{c.h * (0.5 + density * 0.7)}px"
				style:filter="url(#cf-{c.id}) blur(5px)"
				style:opacity={0.35 * density}
				style:background="rgba({rgb}, 0.85)"
				style:animation-duration="{c.dur / spd}s"
				style:animation-delay="{c.delay}s"
			></div>
		{/each}

		{#each near as c (c.id)}
			<div
				class="cloud"
				style:top="{c.top}%"
				style:left="{c.left}%"
				style:width="{c.w * (0.5 + density * 0.7)}px"
				style:height="{c.h * (0.5 + density * 0.7)}px"
				style:filter="url(#cf-{c.id}) blur(2px)"
				style:opacity={0.12 * density}
				style:background="rgba({rgb}, 0.8)"
				style:animation-duration="{c.dur / spd}s"
				style:animation-delay="{c.delay}s"
			></div>
		{/each}
	</div>
{/if}

<style>
	.deck {
		position: absolute;
		top: 12%;
		left: -15%;
		right: -15%;
		height: 52%;
		overflow: hidden;
		pointer-events: none;

		/* Steeper tilt for more dramatic perspective */
		transform: perspective(700px) rotateX(38deg);
		transform-origin: 50% 0%;

		mask-image: linear-gradient(to bottom, transparent 2%, black 18%, black 58%, transparent 95%);
		-webkit-mask-image: linear-gradient(to bottom, transparent 2%, black 18%, black 58%, transparent 95%);
	}

	.cloud {
		position: absolute;
		border-radius: 50%;
		animation-name: drift;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}

	@keyframes drift {
		from { transform: translateX(-60%); }
		to   { transform: translateX(130%); }
	}
</style>
