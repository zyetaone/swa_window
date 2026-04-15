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

	// Per-CSS-Tricks: lower baseFrequency = rounder/fuzzier clouds; more octaves =
	// richer detail. The article's displacement (100-180) and blur (50-60) values
	// are calibrated for 500-px source clouds — we scale proportionally to our
	// 100-240 px sources (~5x smaller → use ~1/5 of those values).
	const clouds: CloudConfig[] = [
		// FAR (horizon) — small, wispy, dense at back, slow drift
		{ id: 0,  seed: 42,   top: -40,  left: -220, w: 100, h: 55,  blur: 13, offset: 130, dur: 200, delay: -10, octaves: 5, freq: 0.014, displace: 60, opacityMul: 0.80, parallax: PARALLAX.far,  smilDur: 80  },
		{ id: 1,  seed: 137,  top: -50,  left: -200, w: 90,  h: 50,  blur: 12, offset: 120, dur: 220, delay: -50, octaves: 5, freq: 0.015, displace: 56, opacityMul: 0.80, parallax: PARALLAX.far,  smilDur: 95  },
		{ id: 2,  seed: 271,  top: -35,  left: -240, w: 110, h: 60,  blur: 14, offset: 140, dur: 190, delay: -80, octaves: 5, freq: 0.014, displace: 64, opacityMul: 0.80, parallax: PARALLAX.far,  smilDur: 70  },
		{ id: 3,  seed: 389,  top: -45,  left: -210, w: 95,  h: 52,  blur: 12, offset: 125, dur: 210, delay: -30, octaves: 5, freq: 0.015, displace: 58, opacityMul: 0.80, parallax: PARALLAX.far,  smilDur: 85  },
		{ id: 4,  seed: 503,  top: -38,  left: -230, w: 105, h: 58,  blur: 13, offset: 135, dur: 195, delay: -65, octaves: 5, freq: 0.014, displace: 62, opacityMul: 0.80, parallax: PARALLAX.far,  smilDur: 90  },
		// MID — medium wisps, moderate density
		{ id: 5,  seed: 619,  top: -80,  left: -180, w: 160, h: 90,  blur: 15, offset: 165, dur: 130, delay: -15, octaves: 5, freq: 0.013, displace: 78, opacityMul: 0.45, parallax: PARALLAX.mid, smilDur: 65  },
		{ id: 6,  seed: 743,  top: -90,  left: -160, w: 150, h: 85,  blur: 14, offset: 155, dur: 140, delay: -45, octaves: 5, freq: 0.014, displace: 75, opacityMul: 0.45, parallax: PARALLAX.mid, smilDur: 55  },
		{ id: 7,  seed: 857,  top: -75,  left: -190, w: 170, h: 95,  blur: 16, offset: 175, dur: 120, delay: -70, octaves: 5, freq: 0.013, displace: 82, opacityMul: 0.45, parallax: PARALLAX.mid, smilDur: 75  },
		{ id: 8,  seed: 967,  top: -85,  left: -170, w: 155, h: 88,  blur: 14, offset: 160, dur: 135, delay: -25, octaves: 5, freq: 0.014, displace: 76, opacityMul: 0.45, parallax: PARALLAX.mid, smilDur: 60  },
		// NEAR (foreground) — larger, closer, faster drift, more visible so
		// they actually read as passing clouds (was nearly invisible at 0.18).
		{ id: 9,  seed: 1087, top: -120, left: -140, w: 220, h: 125, blur: 18, offset: 200, dur: 45,  delay: -10, octaves: 4, freq: 0.013, displace: 92, opacityMul: 0.32, parallax: PARALLAX.near, smilDur: 30  },
		{ id: 10, seed: 1213, top: -130, left: -120, w: 200, h: 115, blur: 17, offset: 190, dur: 40,  delay: -35, octaves: 4, freq: 0.014, displace: 88, opacityMul: 0.30, parallax: PARALLAX.near, smilDur: 35  },
		{ id: 11, seed: 1337, top: -115, left: -150, w: 240, h: 135, blur: 19, offset: 210, dur: 50,  delay: -55, octaves: 4, freq: 0.012, displace: 96, opacityMul: 0.34, parallax: PARALLAX.near, smilDur: 32  },
		{ id: 12, seed: 1453, top: -125, left: -130, w: 210, h: 120, blur: 18, offset: 200, dur: 42,  delay: -80, octaves: 4, freq: 0.013, displace: 90, opacityMul: 0.28, parallax: PARALLAX.near, smilDur: 38  },
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

	function freqLo(freq: number): number { return freq * 0.88; }
	function freqHi(freq: number): number { return freq * 1.12; }
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
	<!-- perspective(1100px) rotateX(50deg) — slight bump from 48° for more airplane-window
	     depth without flattening the deck into opaque bands. The deck extends outward + down
	     from just below the camera; near clouds keep their 3D shape, far clouds compress
	     toward the horizon line. -->
	<div
		class="deck"
		style:top="{4 + altitudeShift}%"
		style:transform="perspective(1100px) rotateX(50deg) skewY({windSkew}deg)"
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
