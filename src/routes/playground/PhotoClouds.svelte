<script lang="ts">
/**
 * PhotoClouds — Dynamic cloud particle pool with SVG feTurbulence rendering.
 *
 * JS-driven RAF positions replace CSS @keyframes. Each cloud respawns at the
 * viewport edge with new random properties (filter seed variant, size, position,
 * rotation) — no visible loop repeat, truly dynamic cloudscape.
 *
 * Rendering pipeline per cloud:
 *   feTurbulence (fractal noise, animated baseFrequency for slow morph)
 *   → feDisplacementMap (warps the black ellipse into cloud silhouette)
 *   → feGaussianBlur (softens edges)
 *   → feColorMatrix (inverts RGB so black becomes white, keeps alpha)
 *
 * Four depth layers: cirrus (z:-1800) → back (z:-1500) → mid (z:-400) → front (z:0)
 * Container perspective makes far layers parallax-shift less with camera shake.
 *
 * Seed is free: different feTurbulence seed = different shape at zero GPU cost.
 * On respawn, clouds cycle to a new filter variant → new seed → new shape.
 *
 * Technique: https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css/
 */

import { untrack } from 'svelte';
import type { WeatherType } from '$lib/types';

let {
	density = 0.6,
	speed = 1.0,
	heading = 90,
	windAngle = 0,
	nightFactor = 0,
	altitude = 30000,
	weather = 'clear' as WeatherType,
	animate = true,
	cloudScale = 1.0,
	cloudSpread = 1.0,
	pitchOffset = 0,
	bankAngle = 0,
}: {
	density?: number;
	speed?: number;
	heading?: number;
	windAngle?: number;
	nightFactor?: number;
	altitude?: number;
	weather?: WeatherType;
	animate?: boolean;
	cloudScale?: number;
	cloudSpread?: number;
	pitchOffset?: number;
	bankAngle?: number;
} = $props();

// ── Weather morphology ─────────────────────────────────────────────────
// Storm = dark, slow, heavy displacement. Clear = bright, fast, wispy.
const wx = $derived.by(() => {
	switch (weather) {
		case 'storm':    return { baseFreqMul: 0.65, displaceMul: 1.45, blurMul: 1.35, darkR: 0.38, darkG: 0.42, darkB: 0.50, morphDurMul: 1.6 };
		case 'rain':     return { baseFreqMul: 0.82, displaceMul: 1.2,  blurMul: 1.15, darkR: 0.52, darkG: 0.55, darkB: 0.62, morphDurMul: 1.2 };
		case 'overcast': return { baseFreqMul: 0.92, displaceMul: 1.05, blurMul: 1.0,  darkR: 0.68, darkG: 0.70, darkB: 0.75, morphDurMul: 1.0 };
		case 'cloudy':   return { baseFreqMul: 1.1,  displaceMul: 0.95, blurMul: 0.9,  darkR: 0.78, darkG: 0.80, darkB: 0.85, morphDurMul: 0.85 };
		default:         return { baseFreqMul: 1.3,  displaceMul: 0.75, blurMul: 0.72, darkR: 0.88, darkG: 0.90, darkB: 0.93, morphDurMul: 0.6 };
	}
});

// Drift direction — clouds move opposite to plane heading + wind
const driftRad = $derived(((heading + windAngle + 180) % 360) * Math.PI / 180);
const driftX = $derived(Math.cos(driftRad));

// feColorMatrix: inverts black ellipse to WHITE cloud. The offsets control
// how bright/white the result is. 1.0 = pure white, lower = gray.
// Day: push toward pure white (0.95-1.0). Night: cool blue-gray.
// Storm/rain: darker undersides.
// Push offsets near 1.0 for daytime → pure white clouds.
// Night → cool blue-gray. Storm → dark undersides.
const rOffset = $derived(
	nightFactor > 0.5
		? (weather === 'storm' ? 0.35 : weather === 'rain' ? 0.55 : 0.75)
		: (weather === 'storm' ? 0.78 : weather === 'rain' ? 0.88 : 1.0)
);
const gOffset = $derived(
	nightFactor > 0.5
		? (weather === 'storm' ? 0.38 : weather === 'rain' ? 0.58 : 0.78)
		: (weather === 'storm' ? 0.80 : weather === 'rain' ? 0.90 : 1.0)
);
const bOffset = $derived(
	nightFactor > 0.5
		? (weather === 'storm' ? 0.50 : weather === 'rain' ? 0.65 : 0.88)
		: (weather === 'storm' ? 0.82 : weather === 'rain' ? 0.92 : 1.0)
);
const alphaOffset = $derived(nightFactor > 0.5 ? -0.08 : 0);
const colorMatrix = $derived(`-1 0 0 0 ${rOffset}  0 -1 0 0 ${gOffset}  0 0 -1 0 ${bOffset}  0 0 0 1 ${alphaOffset}`);

// ── Environment-colored rim glow ────────────────────────────────────
// CSS drop-shadow chained AFTER the SVG filter paints the cloud white.
// The shadow picks up the ambient sky color → clouds feel integrated
// with the lighting rather than pasted on.
const edgeShadow = $derived.by(() => {
	if (nightFactor > 0.7) {
		// Night: cool moonlit blue rim
		return 'drop-shadow(0 2px 12px rgba(80, 110, 180, 0.3))';
	}
	if (nightFactor > 0.3) {
		// Dusk/dawn: warm golden rim
		return 'drop-shadow(0 2px 14px rgba(255, 170, 80, 0.35))';
	}
	if (weather === 'storm' || weather === 'rain') {
		// Storm: dark blueish rim
		return 'drop-shadow(0 3px 10px rgba(60, 70, 100, 0.4))';
	}
	if (weather === 'overcast') {
		return 'drop-shadow(0 2px 10px rgba(140, 150, 170, 0.25))';
	}
	// Clear day: subtle warm atmospheric scatter
	return 'drop-shadow(0 2px 16px rgba(200, 210, 240, 0.2))';
});

// Altitude-aware cloud deck — at 30k ft you're IN the cloud layer.
// Below 18k ft: looking up at clouds (they rise above you).
// Above 38k ft: looking down at cloud tops (they sink below).
// Between: mixed — some above, some below. This shifts the yRanges.
const altitudeShift = $derived.by(() => {
	if (altitude < 18000) return -15;     // clouds pushed up (you're below them)
	if (altitude > 38000) return 20;      // clouds pushed down (you're above them)
	return (altitude - 28000) / 1000;     // gradual shift
});

// Density gates
const showCirrus = $derived(density > 0.05);
const showBack   = $derived(density > 0.1);
const showMid    = $derived(density > 0.3);
const showFront  = $derived(density > 0.55);
const layerOpacity = $derived(Math.min(1, density * 1.1));

// ── Production-matched deck transforms (from CloudBlobs.svelte) ──────

// Wind skew — entire cloud deck leans with wind direction
const windSkew = $derived((90 - windAngle) * 0.4);

// Altitude-coupled deck position — lower altitude = clouds lower on screen
const deckY = $derived(15 * Math.max(0, Math.min(1, (altitude - 15000) / 30000)));

// Per-layer heading parallax — far layers shift less than near.
// Prod uses far=0.15, mid=0.4, near=0.9. We scale per layer in the template.
const PARALLAX = { cirrus: 0.08, back: 0.15, mid: 0.4, front: 0.85 } as const;

// ── Cloud Particle System ────────────────────────────────────────────

interface Particle {
	x: number;         // horizontal position (%)
	y: number;         // final vertical position (% — includes oscillation)
	yBase: number;     // base vertical position (set at spawn)
	z: number;         // final translateZ (px — includes oscillation)
	zBase: number;     // base z-depth (set at spawn)
	vx: number;        // horizontal speed (%/s, always positive)
	vyPhase: number;   // vertical oscillation phase (radians)
	vyAmp: number;     // vertical oscillation amplitude (%)
	width: number;     // element width (%)
	aspect: number;    // width / height ratio
	opacity: number;
	filterIdx: number; // which SVG filter variant (0..filterCount-1)
	scaleX: number;
	scaleY: number;
	// RAF-driven morph: each cloud steps to a new filter variant at its own rate.
	// Desynchronizes SMIL baseFrequency morphing across the cloud field.
	morphTimer: number;  // accumulates in seconds; triggers filterIdx step at >= 1
	morphSpeed: number;  // morph steps per second (0.5 = slow drift, 2 = fast shimmer)
}

interface LayerSpec {
	count: number;
	yRange: [number, number];
	yBias: number;        // pow() exponent — >1 clusters toward yRange[0] (top)
	zBase: number;
	zVar: number;
	zOsc: number;         // z-axis breathing amplitude (px)
	speedBase: number;    // %/s base
	speedVar: number;     // ± variance
	widthRange: [number, number];
	aspectRange: [number, number];
	opacityRange: [number, number];
	filterPrefix: string;
	filterCount: number;
}

// translateZ scaled to fit WITHIN parent perspective (2500px).
// yRanges define the vertical band for each layer (% from top of viewport).
// From a passenger window: horizon ≈ top third, ground below, sky above.
// cloudSpread multiplier widens/narrows these bands dynamically.
// Real airplane window cloud reference:
// - At 30k ft you look DOWN through clouds at terrain
// - Far horizon: dense bright haze, no individual clouds
// - Mid: broken cumulus tops, billowy, extremely soft edges
// - Near/below: individual forms, gaps show terrain, wispy trailing edges
// - Colors: bright white tops, gray-blue undersides, golden at sunset
// - Edges: ALWAYS soft, feathered, dissolve into atmosphere — never hard
// - Coverage: 30-60% broken, gaps throughout
const SPECS: Record<string, LayerSpec> = {
	cirrus: {
		count: 4, yRange: [0, 14], yBias: 1.0,
		zBase: -700, zVar: 80, zOsc: 10,
		speedBase: 2.0, speedVar: 0.6,
		widthRange: [45, 80], aspectRange: [8, 14],   // very wide thin streaks
		opacityRange: [0.05, 0.12],
		filterPrefix: 'cloud-cirrus', filterCount: 4,
	},
	back: {
		count: 8, yRange: [10, 40], yBias: 1.2,      // fewer, wider → cloud banks not blobs
		zBase: -500, zVar: 100, zOsc: 15,
		speedBase: 3.5, speedVar: 0.7,
		widthRange: [30, 55], aspectRange: [3.5, 6],  // WIDE cloud masses
		opacityRange: [0.35, 0.6],                    // translucent so terrain shows through
		filterPrefix: 'cloud-back', filterCount: 5,
	},
	mid: {
		count: 4, yRange: [38, 62], yBias: 1.0,
		zBase: -200, zVar: 60, zOsc: 20,
		speedBase: 10, speedVar: 3,
		widthRange: [25, 45], aspectRange: [3, 5],    // wide mid-level banks
		opacityRange: [0.2, 0.45],
		filterPrefix: 'cloud-mid', filterCount: 5,
	},
	front: {
		count: 2, yRange: [60, 85], yBias: 1.0,
		zBase: 0, zVar: 30, zOsc: 25,
		speedBase: 25, speedVar: 8,
		widthRange: [35, 60], aspectRange: [3, 5],    // large fast-passing banks
		opacityRange: [0.15, 0.35],                   // very transparent
		filterPrefix: 'cloud-front', filterCount: 5,
	},
};

function rand(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function biasedY(spec: LayerSpec): number {
	// cloudSpread widens the yRange around its center.
	// spread=1 → default, spread=2 → double range, spread=0.5 → half.
	const spread = untrack(() => cloudSpread);
	const center = (spec.yRange[0] + spec.yRange[1]) / 2;
	const halfRange = ((spec.yRange[1] - spec.yRange[0]) / 2) * spread;
	const lo = Math.max(0, center - halfRange);
	const hi = Math.min(98, center + halfRange);
	return lo + Math.pow(Math.random(), spec.yBias) * (hi - lo);
}

function createParticle(spec: LayerSpec, idx: number): Particle {
	const yBase = biasedY(spec);
	const zBase = spec.zBase + rand(-spec.zVar, spec.zVar);
	return {
		x: rand(-25, 115),   // distribute across full viewport
		y: yBase, yBase,
		z: zBase, zBase,
		vx: spec.speedBase + rand(-spec.speedVar, spec.speedVar),
		vyPhase: rand(0, Math.PI * 2),
		vyAmp: rand(0.3, 1.2),
		width: rand(spec.widthRange[0], spec.widthRange[1]),
		aspect: rand(spec.aspectRange[0], spec.aspectRange[1]),
		opacity: rand(spec.opacityRange[0], spec.opacityRange[1]),
		filterIdx: idx % spec.filterCount,
		scaleX: rand(1.0, 1.6),           // stretch wide (cloud banks, not balls)
		scaleY: rand(0.6, 0.9),           // compress vertically (flat base)
		// Each cloud morphs to a new filter variant at its own rate — staggered
		// so the cloud field never looks synchronized.
		morphTimer: rand(0, 5),
		morphSpeed: rand(0.5, 2.0),
	};
}

/** Respawn a cloud at the incoming edge with completely new random properties. */
function respawnParticle(c: Particle, spec: LayerSpec, enterFromLeft: boolean): void {
	c.x = enterFromLeft ? rand(-35, -18) : rand(115, 135);
	c.yBase = biasedY(spec);
	c.zBase = spec.zBase + rand(-spec.zVar, spec.zVar);
	c.vx = spec.speedBase + rand(-spec.speedVar, spec.speedVar);
	c.vyPhase = rand(0, Math.PI * 2);
	c.vyAmp = rand(0.3, 1.2);
	c.width = rand(spec.widthRange[0], spec.widthRange[1]);
	c.aspect = rand(spec.aspectRange[0], spec.aspectRange[1]);
	c.opacity = rand(spec.opacityRange[0], spec.opacityRange[1]);
	c.filterIdx = (c.filterIdx + 1 + Math.floor(Math.random() * Math.max(1, spec.filterCount - 1))) % spec.filterCount;
	c.scaleX = rand(1.0, 1.6);
	c.scaleY = rand(0.6, 0.9);
	c.morphTimer = rand(0, 3);
	c.morphSpeed = rand(0.5, 2.0);
}

function tickPool(pool: Particle[], spec: LayerSpec, dt: number): void {
	// untrack(): invariant #3 — 60 Hz reads must not build reactive dependencies
	const drift = untrack(() => driftX);
	const spd = untrack(() => speed);
	// Minimum drift prevents stalling when heading is perpendicular to view
	const dir = Math.abs(drift) > 0.15 ? drift : (drift >= 0 ? 0.2 : -0.2);

	for (const c of pool) {
		// Horizontal drift (mutates in place — perf exception for 37×60fps hot path)
		c.x += c.vx * dt * spd * dir;

		// Vertical + depth oscillation (independent per cloud via vyPhase)
		c.vyPhase += dt * 0.25;
		c.y = c.yBase + Math.sin(c.vyPhase) * c.vyAmp;
		c.z = c.zBase + Math.sin(c.vyPhase * 0.7) * spec.zOsc;

		// Per-cloud morph: each cloud steps to the next filter variant at its own
		// rate. morphSpeed is per-cloud (0.5=gradual, 2=rapid shimmer). This
		// desynchronizes the SMIL baseFrequency morphing across the cloud field.
		c.morphTimer += c.morphSpeed * dt;
		if (c.morphTimer >= 1) {
			c.filterIdx = (c.filterIdx + 1) % spec.filterCount;
			c.morphTimer -= 1;
		}

		// Wrap detection — position alone determines exit edge (handles drift flips)
		if (c.x > 135) respawnParticle(c, spec, true);
		else if (c.x < -35) respawnParticle(c, spec, false);
	}
}

// $state (deep proxy) — each c.x, c.y mutation triggers granular DOM update
// on the specific style binding that reads it. $state.raw doesn't work here
// because {#each} caches on array reference which never changes with mutation.
let cirrusPool = $state(Array.from({ length: SPECS.cirrus.count }, (_, i) => createParticle(SPECS.cirrus, i)));
let backPool   = $state(Array.from({ length: SPECS.back.count },   (_, i) => createParticle(SPECS.back, i)));
let midPool    = $state(Array.from({ length: SPECS.mid.count },    (_, i) => createParticle(SPECS.mid, i)));
let frontPool  = $state(Array.from({ length: SPECS.front.count },  (_, i) => createParticle(SPECS.front, i)));

// Animation loop — ticks all four pools each frame.
// Runs inside $effect for setup/teardown; pool mutations + renderTick++
// happen in the RAF callback (async context, not tracked by the $effect).
$effect(() => {
	let raf: number;
	let last = performance.now();

	const loop = (now: number) => {
		const dt = Math.min((now - last) / 1000, 0.1); // cap to avoid teleport on tab-switch
		last = now;

		tickPool(cirrusPool, SPECS.cirrus, dt);
		tickPool(backPool, SPECS.back, dt);
		tickPool(midPool, SPECS.mid, dt);
		tickPool(frontPool, SPECS.front, dt);

		raf = requestAnimationFrame(loop);
	};
	raf = requestAnimationFrame(loop);
	return () => cancelAnimationFrame(raf);
});
</script>

<!-- SVG filter definitions — 5 seed variants per main layer + 4 cirrus.
     Weather morphology: all filter params scale with wx.* multipliers.
     Animated baseFrequency causes continuous shape morphing independent of drift. -->
<svg class="defs" aria-hidden="true">
	<defs>
		{#each [2, 11, 23, 37] as seedNum, i (seedNum)}
			<filter id="cloud-cirrus-{i}" x="-100%" y="-100%" width="300%" height="300%">
				<feGaussianBlur in="SourceGraphic" stdDeviation={2 * wx.blurMul} result="pre" />
				<feTurbulence type="fractalNoise" baseFrequency={0.030 * wx.baseFreqMul + i * 0.004} numOctaves="2" seed={seedNum} result="noise">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(22 + i * 4) * wx.morphDurMul}s"
							values="{(0.022 + i * 0.004) * wx.baseFreqMul};{(0.038 + i * 0.004) * wx.baseFreqMul};{(0.028 + i * 0.004) * wx.baseFreqMul};{(0.022 + i * 0.004) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feDisplacementMap in="pre" in2="noise" scale={18 * wx.displaceMul} result="disp" />
				<feGaussianBlur in="disp" stdDeviation={1.5 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>
		{/each}

		{#each [1, 7, 13, 19, 31] as seedNum, i (seedNum)}
			<!--
				Double-turbulence pipeline (CSS-Tricks article, comment #5):
				1. feTurbulence #1 — primary noise field (displaces SourceGraphic)
				2. feGaussianBlur — softens the displacement field
				3. feTurbulence #2 — secondary noise at half frequency (adds low-freq depth)
				4. feBlend (screen) — combines both turbulence fields
				5. feDisplacementMap — uses the blended field to warp the pre-blurred source
				6. feColorMatrix — RGB invert (black→white) + weather/night tint
				Result: richer Perlin layering = more natural cloud texture variation.
			-->
			<filter id="cloud-back-{i}" x="-40%" y="-40%" width="180%" height="180%">
				<!-- feTurbulence #1 — primary displacement field -->
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.008 + i * 0.002) * wx.baseFreqMul}
					numOctaves="5"
					seed={seedNum}
					result="noise1">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(42 + i * 3) * wx.morphDurMul}s"
							values="{(0.008 + i * 0.002) * wx.baseFreqMul};{(0.018 + i * 0.002) * wx.baseFreqMul};{(0.012 + i * 0.002) * wx.baseFreqMul};{(0.008 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<!-- feTurbulence #2 — half-frequency second field for low-freq depth -->
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.005 + i * 0.001) * wx.baseFreqMul}
					numOctaves="3"
					seed={seedNum + 500}
					result="noise2" />
				<!-- feGaussianBlur softens noise1 before displacement -->
				<feGaussianBlur in="noise1" stdDeviation={3 * wx.blurMul} result="noise1b" />
				<!-- Blend both turbulence fields — 'screen' preserves bright lobes of each -->
				<feBlend in="noise1b" in2="noise2" mode="screen" result="blended" />
				<!-- Pre-blur the SourceGraphic ellipse so displacement gives wispy edges (CSS-Tricks technique) -->
				<feGaussianBlur in="SourceGraphic" stdDeviation={8 * wx.blurMul} result="pre" />
				<!-- Heavy displacement → organic billowy shapes, not round blobs -->
				<feDisplacementMap in="pre" in2="blended" scale={(95 + i * 8) * wx.displaceMul} xChannelSelector="R" yChannelSelector="G" result="disp" />
				<!-- Strong final softening → feathered edges that dissolve into atmosphere -->
				<feGaussianBlur in="disp" stdDeviation={6 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-mid-{i}" x="-35%" y="-35%" width="170%" height="170%">
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.014 + i * 0.002) * wx.baseFreqMul}
					numOctaves="4"
					seed={seedNum + 100}
					result="noise1">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(28 + i * 2) * wx.morphDurMul}s"
							values="{(0.012 + i * 0.002) * wx.baseFreqMul};{(0.022 + i * 0.002) * wx.baseFreqMul};{(0.016 + i * 0.002) * wx.baseFreqMul};{(0.012 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.007 + i * 0.001) * wx.baseFreqMul}
					numOctaves="3"
					seed={seedNum + 600}
					result="noise2" />
				<feGaussianBlur in="noise1" stdDeviation={2.5 * wx.blurMul} result="noise1b" />
				<feBlend in="noise1b" in2="noise2" mode="screen" result="blended" />
				<feGaussianBlur in="SourceGraphic" stdDeviation={7 * wx.blurMul} result="pre" />
				<feDisplacementMap in="pre" in2="blended" scale={(75 + i * 6) * wx.displaceMul} xChannelSelector="R" yChannelSelector="G" result="disp" />
				<feGaussianBlur in="disp" stdDeviation={5 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>

			<filter id="cloud-front-{i}" x="-35%" y="-35%" width="170%" height="170%">
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.017 + i * 0.002) * wx.baseFreqMul}
					numOctaves="4"
					seed={seedNum + 200}
					result="noise1">
					{#if animate}
						<animate attributeName="baseFrequency"
							dur="{(18 + i) * wx.morphDurMul}s"
							values="{(0.015 + i * 0.002) * wx.baseFreqMul};{(0.027 + i * 0.002) * wx.baseFreqMul};{(0.019 + i * 0.002) * wx.baseFreqMul};{(0.015 + i * 0.002) * wx.baseFreqMul}"
							repeatCount="indefinite" />
					{/if}
				</feTurbulence>
				<feTurbulence type="fractalNoise"
					baseFrequency={(0.008 + i * 0.001) * wx.baseFreqMul}
					numOctaves="3"
					seed={seedNum + 700}
					result="noise2" />
				<feGaussianBlur in="noise1" stdDeviation={2 * wx.blurMul} result="noise1b" />
				<feBlend in="noise1b" in2="noise2" mode="screen" result="blended" />
				<feGaussianBlur in="SourceGraphic" stdDeviation={6 * wx.blurMul} result="pre" />
				<feDisplacementMap in="pre" in2="blended" scale={(70 + i * 5) * wx.displaceMul} xChannelSelector="R" yChannelSelector="G" result="disp" />
				<feGaussianBlur in="disp" stdDeviation={4 * wx.blurMul} result="soft" />
				<feColorMatrix in="soft" type="matrix" values={colorMatrix} />
			</filter>
		{/each}
	</defs>
</svg>

<div class="photo-clouds" style:opacity={layerOpacity} aria-hidden="true">
	<!-- Cloud deck — wind skew + altitude coupling.
	     altitudeShift moves the whole deck vertically based on flight level:
	     below 18k = clouds above you, above 38k = clouds below you. -->
	<div
		class="cloud-deck"
		style:transform="skewY({windSkew}deg) translateY({altitudeShift}%) translateY({pitchOffset * 1.5}px) rotate({bankAngle * 0.3}deg)"
		style:bottom="{deckY}%"
	>
		{#if showCirrus}
			<div class="layer" style:transform="translateX({heading * PARALLAX.cirrus}px)">
				{#each cirrusPool as c, i (i)}
					<div class="seed"
						style:left="{c.x}%"
						style:top="{c.y}%"
						style:width="{c.width * cloudScale}%"
						style:aspect-ratio="{c.aspect}"
						style:opacity={c.opacity}
						style:filter="url(#cloud-cirrus-{c.filterIdx}) {edgeShadow}"
						style:transform="translate3d(0,0,{c.z}px) scale({c.scaleX},{c.scaleY})"
					></div>
				{/each}
			</div>
		{/if}

		{#if showBack}
			<div class="layer" style:transform="translateX({heading * PARALLAX.back}px)">
				{#each backPool as c, i (i)}
					<div class="seed"
						style:left="{c.x}%"
						style:top="{c.y}%"
						style:width="{c.width * cloudScale}%"
						style:aspect-ratio="{c.aspect}"
						style:opacity={c.opacity}
						style:filter="url(#cloud-back-{c.filterIdx}) {edgeShadow}"
						style:transform="translate3d(0,0,{c.z}px) scale({c.scaleX},{c.scaleY})"
					></div>
				{/each}
			</div>
		{/if}

		{#if showMid}
			<div class="layer" style:transform="translateX({heading * PARALLAX.mid}px)">
				{#each midPool as c, i (i)}
					<div class="seed"
						style:left="{c.x}%"
						style:top="{c.y}%"
						style:width="{c.width * cloudScale}%"
						style:aspect-ratio="{c.aspect}"
						style:opacity={c.opacity}
						style:filter="url(#cloud-mid-{c.filterIdx}) {edgeShadow}"
						style:transform="translate3d(0,0,{c.z}px) scale({c.scaleX},{c.scaleY})"
					></div>
				{/each}
			</div>
		{/if}

		{#if showFront}
			<div class="layer" style:transform="translateX({heading * PARALLAX.front}px)">
				{#each frontPool as c, i (i)}
					<div class="seed"
						style:left="{c.x}%"
						style:top="{c.y}%"
						style:width="{c.width * cloudScale}%"
						style:aspect-ratio="{c.aspect}"
						style:opacity={c.opacity}
						style:filter="url(#cloud-front-{c.filterIdx}) {edgeShadow}"
						style:transform="translate3d(0,0,{c.z}px) scale({c.scaleX},{c.scaleY})"
					></div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	.photo-clouds {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		overflow: hidden;
		will-change: opacity;
		transition: opacity 1.5s ease;
		/* Shared vanishing point for all child translateZ values.
		   2500px = safe for z values down to -700px (back clouds). */
		perspective: 2500px;
		perspective-origin: 50% 42%;
		/* Gradient mask — dense clouds in middle, transparent at horizon + bottom.
		   Matches prod CloudBlobs for natural fade into sky/ground. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 85%, transparent 100%);
		mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 85%, transparent 100%);
	}

	/* Cloud deck — perspective + rotateX compresses far-z clouds toward horizon,
	   giving the airplane-window depth illusion. Wind skew + altitude coupling
	   applied via inline style. */
	.cloud-deck {
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
		transform-origin: 50% 45%;
	}

	.layer {
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
	}

	.seed {
		position: absolute;
		/* Gradient: darkest at top → lighter at bottom.
		   After feColorMatrix inversion: TOP = bright white (sunlit), BOTTOM = soft gray (shadow).
		   From airplane looking down: you see the bright sun-lit cloud tops.
		   #000 inverts to full white, #444 inverts to light gray. */
		background: linear-gradient(to bottom, #000 0%, #0a0a0a 40%, #222 75%, #444 100%);
		border-radius: 50% 50% 42% 42%;
		will-change: transform;
	}

	@media (prefers-reduced-motion: reduce) {
		.photo-clouds { display: none; }
	}
</style>
