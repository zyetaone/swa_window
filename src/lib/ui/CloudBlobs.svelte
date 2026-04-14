<script lang="ts">
	/**
	 * CloudBlobs — SVG feTurbulence horizon cloud deck
	 *
	 * Enhancements from https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/:
	 * 1. Box-shadow cloud body: div hidden offscreen, shadow IS the cloud
	 * 2. SMIL baseFrequency animation: continuous turbulence morphing
	 * 3. Seed morphing via RAF: periodic seed refresh for shape variation
	 *
	 * Plane-coupled: heading shifts clouds laterally (parallax by depth),
	 * altitude shifts the cloud band vertically.
	 */

	import { onMount } from 'svelte';
	import type { SkyState } from '$lib/types';

	interface Props {
		density?: number;
		skyState?: SkyState;
		speed?: number;
		time?: number;
		heading?: number;
		altitude?: number;
		windAngle?: number;
	}

	let {
		density = 0.5,
		skyState = 'day' as SkyState,
		speed = 1.0,
		heading = 0,
		altitude = 30000,
		windAngle = 90,
	}: Props = $props();

	const PARALLAX = { far: 0.15, mid: 0.4, near: 0.9 };

	interface CloudConfig {
		id: number;
		seed: number;
		top: number;
		left: number;
		w: number;
		h: number;
		blur: number;
		offset: number;
		dur: number;
		delay: number;
		octaves: number;
		freq: number;
		displace: number;
		opacityMul: number;
		parallax: number;
		smilDur: number;
	}

	const clouds: CloudConfig[] = [
		// FAR (horizon) — wide, soft, slow morphing
		{ id: 0,  seed: 42,   top: -100, left: -420, w: 500, h: 280, blur: 40, offset: 420, dur: 160, delay: -10, octaves: 5, freq: 0.008, displace: 120, opacityMul: 0.70, parallax: PARALLAX.far, smilDur: 80 },
		{ id: 1,  seed: 137,  top: -110, left: -400, w: 480, h: 260, blur: 38, offset: 400, dur: 180, delay: -50, octaves: 5, freq: 0.009, displace: 115, opacityMul: 0.70, parallax: PARALLAX.far, smilDur: 95 },
		{ id: 2,  seed: 271,  top: -95,  left: -430, w: 520, h: 300, blur: 42, offset: 430, dur: 150, delay: -80, octaves: 5, freq: 0.008, displace: 125, opacityMul: 0.70, parallax: PARALLAX.far, smilDur: 70 },
		{ id: 3,  seed: 389,  top: -105, left: -415, w: 490, h: 270, blur: 39, offset: 415, dur: 170, delay: -30, octaves: 5, freq: 0.009, displace: 118, opacityMul: 0.70, parallax: PARALLAX.far, smilDur: 85 },
		{ id: 4,  seed: 503,  top: -98,  left: -425, w: 510, h: 290, blur: 41, offset: 425, dur: 155, delay: -65, octaves: 5, freq: 0.008, displace: 122, opacityMul: 0.70, parallax: PARALLAX.far, smilDur: 90 },
		// MID — medium, moderate
		{ id: 5,  seed: 619,  top: -180, left: -380, w: 600, h: 350, blur: 28, offset: 380, dur: 100, delay: -15, octaves: 4, freq: 0.010, displace: 100, opacityMul: 0.40, parallax: PARALLAX.mid, smilDur: 65 },
		{ id: 6,  seed: 743,  top: -175, left: -390, w: 580, h: 330, blur: 26, offset: 390, dur: 110, delay: -45, octaves: 4, freq: 0.011, displace: 98,  opacityMul: 0.40, parallax: PARALLAX.mid, smilDur: 55 },
		{ id: 7,  seed: 857,  top: -185, left: -370, w: 620, h: 360, blur: 30, offset: 370, dur: 95,  delay: -70, octaves: 4, freq: 0.010, displace: 102, opacityMul: 0.40, parallax: PARALLAX.mid, smilDur: 75 },
		{ id: 8,  seed: 967,  top: -170, left: -385, w: 590, h: 340, blur: 27, offset: 385, dur: 105, delay: -25, octaves: 4, freq: 0.011, displace: 99,  opacityMul: 0.40, parallax: PARALLAX.mid, smilDur: 60 },
		// NEAR (foreground) — large, closer, faster
		{ id: 9,  seed: 1087, top: -250, left: -350, w: 750, h: 450, blur: 18, offset: 350, dur: 65,  delay: -10, octaves: 3, freq: 0.012, displace: 85,  opacityMul: 0.14, parallax: PARALLAX.near, smilDur: 45 },
		{ id: 10, seed: 1213, top: -260, left: -340, w: 720, h: 430, blur: 16, offset: 340, dur: 55,  delay: -35, octaves: 3, freq: 0.013, displace: 82,  opacityMul: 0.14, parallax: PARALLAX.near, smilDur: 50 },
		{ id: 11, seed: 1337, top: -245, left: -355, w: 780, h: 470, blur: 19, offset: 355, dur: 70,  delay: -55, octaves: 3, freq: 0.012, displace: 88,  opacityMul: 0.14, parallax: PARALLAX.near, smilDur: 48 },
	];

	// Live seeds — periodically bumped for smooth shape morphing
	let liveSeeds = $state<number[]>(clouds.map(c => c.seed));

	onMount(() => {
		let raf: number;
		let lastMorph = 0;
		const MORPH_INTERVAL = 4000; // ms between seed jumps per cloud

		function tick(now: number) {
			if (now - lastMorph > MORPH_INTERVAL) {
				liveSeeds = clouds.map(c => c.seed + Math.floor(now / MORPH_INTERVAL + c.id * 7));
				lastMorph = now;
			}
			raf = requestAnimationFrame(tick);
		}
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	function headingOffset(c: CloudConfig): number {
		return heading * c.parallax;
	}

	const altitudeShift = $derived(
		((altitude - 15000) / 25000) * 15
	);

	const windSkew = $derived.by(() => (90 - windAngle) * 0.5);

	const rgb = $derived.by(() => {
		switch (skyState) {
			case 'night': return '180,190,215';
			case 'dawn':
			case 'dusk':  return '255,230,195';
			default:      return '255,255,255';
		}
	});

	const clampedSpeed = $derived(Math.max(speed, 0.2));

	function freqLo(freq: number): number { return freq * 0.65; }
	function freqHi(freq: number): number { return freq * 1.35; }
</script>

<svg width="0" height="0" aria-hidden="true" style="position:absolute">
	{#each clouds as c, i (c.id)}
		<filter id="cf-{c.id}" x="-50%" y="-50%" width="200%" height="200%">
			<feTurbulence
				type="fractalNoise"
				baseFrequency={c.freq}
				numOctaves={c.octaves}
				seed={liveSeeds[i]}
				result="noise"
			>
				<animate
					attributeName="baseFrequency"
					from={freqLo(c.freq)}
					to={freqHi(c.freq)}
					dur="{c.smilDur}s"
					repeatCount="indefinite"
					calcMode="spline"
					keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
				/>
			</feTurbulence>
			<feDisplacementMap in="SourceGraphic" in2="noise" scale={c.displace} xChannelSelector="R" yChannelSelector="G" result="displaced" />
			<feGaussianBlur in="displaced" stdDeviation={c.blur} />
		</filter>
	{/each}
</svg>

{#if density > 0.01}
	<div
		class="deck"
		style:top="{4 + altitudeShift}%"
		style:transform="perspective(1100px) rotateX(48deg) skewY({windSkew}deg)"
		style:transform-origin="50% 0%"
	>
	{#each clouds as c (c.id)}
			<div
				class="cloud"
				style:top="{c.top}px"
				style:left="calc({c.left}px + {headingOffset(c)}px)"
				style:width="{c.w}px"
				style:height="{c.h}px"
				style:border-radius="50%"
				style:filter="url(#cf-{c.id})"
				style:opacity={c.opacityMul * density}
				style:background="rgba({rgb}, 1)"
				style:box-shadow="{c.offset}px {c.offset}px {c.blur}px 0 rgba({rgb}, 0.85)"
				style:animation-duration="{c.dur / clampedSpeed}s"
				style:animation-delay="{c.delay}s"
			></div>
		{/each}
	</div>
{/if}

<style>
	.deck {
		position: absolute;
		left: -40%;
		right: -40%;
		height: 70%;
		overflow: hidden;
		pointer-events: none;
		will-change: transform;
		/* Fade to horizon: clouds dense in middle, fully transparent at far edge */
		mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 70%, transparent 100%);
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 12%, black 70%, transparent 100%);
	}

	.cloud {
		position: absolute;
		visibility: visible;
		will-change: transform;
		animation-name: drift;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}

	@keyframes drift {
		from { transform: translateX(-60%); }
		to   { transform: translateX(130%); }
	}
</style>
