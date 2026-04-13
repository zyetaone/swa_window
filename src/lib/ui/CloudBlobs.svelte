<script lang="ts">
	/**
	 * CloudBlobs — SVG feTurbulence horizon cloud deck
	 *
	 * Plane-coupled: heading shifts clouds laterally (parallax by depth),
	 * altitude shifts the cloud band vertically.
	 * Ref: https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/
	 */

	import type { SkyState } from '$lib/shared/types';

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
		time = 0,
		heading = 0,
		altitude = 30000,
		windAngle = 90,
	}: Props = $props();

	// Parallax factor: how much each depth layer shifts per degree of heading.
	// Far clouds barely move (they're distant), near clouds shift a lot.
	const PARALLAX = { far: 0.15, mid: 0.4, near: 0.9 };

	interface CloudConfig {
		id: number;
		seed: number;
		top: number;
		left: number;
		w: number;
		h: number;
		dur: number;
		delay: number;
		octaves: number;
		freq: number;
		displace: number;
		svgBlur: number;
		opacityMul: number;
		bgAlpha: number;
		parallax: number;
	}

	const clouds: CloudConfig[] = [
		// FAR (horizon)
		{ id: 0, seed: 42,  top: 2,  left: -5,  w: 250, h: 90,  dur: 160, delay: -10, octaves: 4, freq: 0.009, displace: 70, svgBlur: 8,  opacityMul: 0.65, bgAlpha: 0.9, parallax: PARALLAX.far },
		{ id: 1, seed: 137, top: 10, left: 20,  w: 220, h: 80,  dur: 180, delay: -50, octaves: 4, freq: 0.009, displace: 70, svgBlur: 8,  opacityMul: 0.65, bgAlpha: 0.9, parallax: PARALLAX.far },
		{ id: 2, seed: 271, top: 5,  left: 45,  w: 280, h: 100, dur: 150, delay: -80, octaves: 4, freq: 0.009, displace: 70, svgBlur: 8,  opacityMul: 0.65, bgAlpha: 0.9, parallax: PARALLAX.far },
		{ id: 3, seed: 389, top: 12, left: 70,  w: 240, h: 85,  dur: 170, delay: -30, octaves: 4, freq: 0.009, displace: 70, svgBlur: 8,  opacityMul: 0.65, bgAlpha: 0.9, parallax: PARALLAX.far },
		{ id: 4, seed: 503, top: 8,  left: 92,  w: 260, h: 95,  dur: 155, delay: -65, octaves: 4, freq: 0.009, displace: 70, svgBlur: 8,  opacityMul: 0.65, bgAlpha: 0.9, parallax: PARALLAX.far },
		// MID
		{ id: 5, seed: 619, top: 28, left: -10, w: 380, h: 150, dur: 100, delay: -15, octaves: 3, freq: 0.008, displace: 60, svgBlur: 6,  opacityMul: 0.35, bgAlpha: 0.85, parallax: PARALLAX.mid },
		{ id: 6, seed: 743, top: 35, left: 25,  w: 350, h: 130, dur: 110, delay: -45, octaves: 3, freq: 0.008, displace: 60, svgBlur: 6,  opacityMul: 0.35, bgAlpha: 0.85, parallax: PARALLAX.mid },
		{ id: 7, seed: 857, top: 30, left: 55,  w: 400, h: 140, dur: 95,  delay: -70, octaves: 3, freq: 0.008, displace: 60, svgBlur: 6,  opacityMul: 0.35, bgAlpha: 0.85, parallax: PARALLAX.mid },
		{ id: 8, seed: 967, top: 38, left: 80,  w: 360, h: 135, dur: 105, delay: -25, octaves: 3, freq: 0.008, displace: 60, svgBlur: 6,  opacityMul: 0.35, bgAlpha: 0.85, parallax: PARALLAX.mid },
		// NEAR (foreground)
		{ id: 9,  seed: 1087, top: 55, left: -20, w: 600, h: 240, dur: 65, delay: -10, octaves: 2, freq: 0.006, displace: 50, svgBlur: 4, opacityMul: 0.12, bgAlpha: 0.8, parallax: PARALLAX.near },
		{ id: 10, seed: 1213, top: 65, left: 30,  w: 550, h: 220, dur: 55, delay: -35, octaves: 2, freq: 0.006, displace: 50, svgBlur: 4, opacityMul: 0.12, bgAlpha: 0.8, parallax: PARALLAX.near },
		{ id: 11, seed: 1337, top: 58, left: 65,  w: 650, h: 260, dur: 70, delay: -55, octaves: 2, freq: 0.006, displace: 50, svgBlur: 4, opacityMul: 0.12, bgAlpha: 0.8, parallax: PARALLAX.near },
	];

	function cloudSeed(c: CloudConfig): number {
		return c.seed + Math.floor((time + Math.abs(c.delay) * 3) / 90);
	}

	// Heading-driven horizontal offset per cloud (px).
	// Heading in degrees → small px shift scaled by each cloud's parallax factor.
	// Near clouds slide fast on heading change, far clouds barely move.
	function headingOffset(c: CloudConfig): number {
		return heading * c.parallax;
	}

	// Altitude shifts the cloud band vertically.
	// Higher altitude = clouds appear lower (you're above them).
	// Range: at 15k ft clouds are at viewport center, at 40k ft they're near bottom.
	const altitudeShift = $derived(
		((altitude - 15000) / 25000) * 15 // 0-15% downward shift
	);

	// Wind direction: skew the deck so drift angle matches windAngle.
	// 90° = pure horizontal (default). Lower = rightward tilt, higher = leftward tilt.
	// CSS rotateX(38deg) makes "up" in cloud space point toward horizon/sky.
	// windAngle from WEATHER_EFFECTS is 84-88° — nearly due west.
	const windSkew = $derived.by(() => {
		// windAngle deviation from 90° → skewY degrees
		// e.g., 86° → -4° skew → drift tilts rightward (matching rain angle)
		return (90 - windAngle) * 0.5;
	});

	const rgb = $derived.by(() => {
		switch (skyState) {
			case 'night': return '180,190,215';
			case 'dawn':
			case 'dusk':  return '255,230,195';
			default:      return '255,255,255';
		}
	});

	const clampedSpeed = $derived(Math.max(speed, 0.2));
</script>

<svg width="0" height="0" aria-hidden="true">
	{#each clouds as c (c.id)}
		<filter id="cf-{c.id}" x="-30%" y="-30%" width="160%" height="160%">
			<feTurbulence type="fractalNoise" baseFrequency={c.freq} numOctaves={c.octaves} seed={cloudSeed(c)} />
			<feDisplacementMap in="SourceGraphic" scale={c.displace} />
			<feGaussianBlur stdDeviation={c.svgBlur} />
		</filter>
	{/each}
</svg>

{#if density > 0.01}
	<div class="deck" style:top="{12 + altitudeShift}%" style:transform="perspective(700px) rotateX(38deg) skewY({windSkew}deg)" style:transform-origin="50% 0%">
		{#each clouds as c (c.id)}
			<div
				class="cloud"
				style:top="{c.top}%"
				style:left="calc({c.left}% + {headingOffset(c)}px)"
				style:width="{c.w * (0.5 + density * 0.7)}px"
				style:height="{c.h * (0.5 + density * 0.7)}px"
				style:filter="url(#cf-{c.id})"
				style:opacity={c.opacityMul * density}
				style:background="rgba({rgb}, {c.bgAlpha})"
				style:animation-duration="{c.dur / clampedSpeed}s"
				style:animation-delay="{c.delay}s"
			></div>
		{/each}
	</div>
{/if}

<style>
	.deck {
		position: absolute;
		left: -15%;
		right: -15%;
		height: 52%;
		overflow: hidden;
		pointer-events: none;
		will-change: transform;
		mask-image: linear-gradient(to bottom, transparent 2%, black 18%, black 58%, transparent 95%);
		-webkit-mask-image: linear-gradient(to bottom, transparent 2%, black 18%, black 58%, transparent 95%);
	}

	.cloud {
		position: absolute;
		border-radius: 50%;
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
