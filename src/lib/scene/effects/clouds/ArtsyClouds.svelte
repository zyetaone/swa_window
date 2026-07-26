<script lang="ts">
/**
 * CSS3DClouds — Volumetric clouds via stacked PNG sprites in CSS 3D space.
 *
 * Technique: Jaume Sánchez (spite) — https://www.clicktorelease.com/code/css3dclouds/
 * Adapted for airplane window passenger view with environment color integration.
 *
 * Each cloud = 1 cloudBase div + 8-14 semi-transparent PNG <img> sprites
 * stacked at different Z-depths. Multiple overlapping alpha-blended sprites
 * create volumetric appearance. 100% GPU-composited CSS transforms.
 *
 * Environment integration:
 * - Edge glow picks up sky/horizon color via CSS drop-shadow
 * - Gray undersides via per-sprite brightness (bottom sprites darker)
 * - Night tint via CSS filter on container
 * - Weather-responsive texture selection (clear=white, storm=dark+smoke)
 */

import { untrack } from 'svelte';
import type { EffectProps } from '$lib/scene/types';
import { WEATHER_EFFECTS } from '$content/weather';
import { pickCloudComposition, type CloudComposition } from '$content/compositions/clouds';
import { subscribe } from '$lib/game-loop';
import { createSeededRng, daySeed } from '$lib/world-three/prng';
	import { randomBetween } from '$lib/utils';

// Effect-component signature — compositor passes { model }. The wrapper
// that used to unpack model into explicit props (CloudsEffect.svelte) is
// gone per Rule 3 (one component per effect folder).
let { model }: EffectProps = $props();

const density = $derived(model.effectiveCloudDensity);
const speed = $derived(model.config.atmosphere.clouds.speed);
const heading = $derived(model.flight.heading);
const altitude = $derived(model.flight.altitude);
const nightFactor = $derived(model.nightFactor);
const weather = $derived(model.weather);
const skyState = $derived<string>(model.skyState);

// Static tuning — the wrapper only ever passed cloudScale=1.0 and left
// edgeColor at its default. Keeping them as constants here instead of
// prop defaults since there's exactly one caller (the effect registry).
const cloudScale = 1.0;
const edgeColor = 'rgba(180, 200, 230, 0.3)';

// Weather auto-sets minimum cloud density — cloudy=0.7, storm=0.98
const weatherDensityFloor = $derived(WEATHER_EFFECTS[weather]?.cloudDensityRange?.[0] ?? 0);
const nightCloudFloor = $derived(WEATHER_EFFECTS[weather]?.nightCloudFloor ?? 0);
const effectiveDensity = $derived(Math.max(density, weatherDensityFloor));

// ── Cloud generation ─────────────────────────────────────────────────

interface CloudSprite {
	x: number;       // vw offset from cloud center
	y: number;       // vw offset
	z: number;       // px depth within cloud
	rot: number;     // rotateZ degrees — slowly animates
	scale: number;
	speed: number;   // rotation speed
	texture: string;
	opacity: number;
	brightness: number; // 0.6 (bottom/shadow) to 1.0 (top/sunlit)
}

interface Cloud {
	x: number;       // % position on screen
	y: number;
	z: number;       // translateZ for parallax depth
	vx: number;      // horizontal drift speed (%/s)
	baseScale: number; // overall cloud size multiplier
	sprites: CloudSprite[];
}

// Per-weather texture pool. cloudy/clear use the soft white sprite only;
// rain mixes white + dark; overcast/storm share the dark+smoke pool.
const HEAVY = ['/cloud-dark.webp', '/cloud-smoke.webp'] as const;
const textureSets: Record<string, readonly string[]> = {
	clear: ['/cloud.webp'],
	cloudy: ['/cloud.webp'],
	rain: ['/cloud.webp', '/cloud-dark.webp'],
	overcast: HEAVY,
	storm: HEAVY,
};

// rand/randRange/randCount accept an optional `rng` — defaults to Math.random
// so per-event per-frame callers (cloud-wraparound resets in the animation
// loop below) don't need to thread a seeded rng. Build-once callers (cloud
// rebuild $effect) pass a daySeed-seeded rng to keep 3-Pi panorama in sync.
function randRange(r: readonly [number, number], rng: () => number = Math.random) {
	return randomBetween(r[0], r[1], rng);
}
function randCount(r: readonly [number, number], rng: () => number = Math.random) {
	return Math.floor(r[0] + rng() * (r[1] - r[0] + 1));
}

function createSprites(
	count: number,
	textures: readonly string[],
	isHorizon: boolean,
	rng: () => number = Math.random,
): CloudSprite[] {
	const sprites: CloudSprite[] = [];
	for (let i = 0; i < count; i++) {
		const y = randomBetween(-5, 5, rng);
		sprites.push({
			x: randomBetween(-8, 8, rng),
			y,
			z: isHorizon ? randomBetween(-80, 80, rng) : randomBetween(-100, 100, rng),
			rot: randomBetween(0, 360, rng),
			scale: isHorizon ? randomBetween(0.5, 1.3, rng) : randomBetween(0.5, 1.4, rng),
			speed: isHorizon ? randomBetween(0.01, 0.05, rng) : randomBetween(0.015, 0.08, rng),
			texture: textures[Math.floor(rng() * textures.length)],
			// Horizon sprites lower opacity so terrain shows through (haze, not wall)
			opacity: isHorizon ? randomBetween(0.18, 0.38, rng) : randomBetween(0.55, 0.92, rng),
			brightness: isHorizon ? 0.8 + (y + 5) / 10 * 0.2 : 0.7 + (y + 5) / 10 * 0.35,
		});
	}
	return sprites;
}

// Phase 11 — composition-driven cloud generation. Picker chooses a recipe
// from $content/compositions/clouds on weather change; the recipe controls
// horizon + mid band counts, y-bands, scales, speeds, and sprites-per-cloud.
//
// Z-depth tracks Y: higher in the sky = deeper (farther). Without this
// correlation every horizon cloud sits at the same z-range and the bank
// reads as a flat wall. With it, the y=6 puffs sit at z≈-1600 (far back)
// and the y=44 horizon-line clouds at z≈-700 (closer) — three perceptual
// depths across one band, which is the perspective the user asked for.
function createCloudFromBand(
	band: CloudComposition['horizon'],
	textures: readonly string[],
	isHorizon: boolean,
	rng: () => number = Math.random,
): Cloud {
	const y = randRange(band.yRange, rng);
	// Lerp z by y position within the band so perspective reads.
	const yMin = band.yRange[0];
	const yMax = band.yRange[1];
	const t = yMax === yMin ? 0 : (y - yMin) / (yMax - yMin);
	const zNear = isHorizon ? -700 : -60;
	const zFar = isHorizon ? -1600 : -400;
	// High y (deeper in band) reads as closer, so lerp from far → near as t grows.
	const z = zFar + (zNear - zFar) * t + randomBetween(-80, 80, rng);
	return {
		x: randomBetween(-30, 130, rng),
		y,
		z,
		vx: randRange(band.speedRange, rng),
		baseScale: randRange(band.scaleRange, rng),
		sprites: createSprites(randCount(band.spritesPerCloud, rng), textures, isHorizon, rng),
	};
}

const composition = $derived.by<CloudComposition>(() => {
	void weather;
	return pickCloudComposition(weather);
});

const horizonCount = $derived(
	Math.max(composition.horizon.countMin, Math.round(effectiveDensity * composition.horizon.countMul)),
);
const midCount = $derived(
	Math.max(composition.mid.countMin, Math.round(effectiveDensity * composition.mid.countMul)),
);

let clouds = $state<Cloud[]>([]);
$effect(() => {
	// Re-roll cloud layout when weather changes OR composition picker
	// returns a new recipe (also triggered by weather change). Reading
	// composition.id here is what binds the effect to the picker.
	void composition.id;
	// 3-Pi panorama determinism: seed with daySeed() so all three Pis
	// generate identical cloud positions on the same day. Without this,
	// each Pi picks its own Math.random and the cloud seam between
	// adjacent screens breaks. Matches the Clouds.svelte / NightStars
	// canonical pattern. Per-frame wraparound resets in the animation
	// loop below stay live (Math.random) — that's per-event randomness,
	// invisible across the panorama seam.
	const rng = createSeededRng(daySeed());
	const textures = textureSets[weather] ?? textureSets.clear;
	const horizon = Array.from({ length: horizonCount }, () =>
		createCloudFromBand(composition.horizon, textures, true, rng),
	);
	const mid = Array.from({ length: midCount }, () =>
		createCloudFromBand(composition.mid, textures, false, rng),
	);
	clouds = [...horizon, ...mid];
});

// ── Animation loop ───────────────────────────────────────────────────
// Subscribe to the shared game-loop RAF — same source the rest of the
// scene effects use. Earlier this owned its own requestAnimationFrame
// which meant two concurrent RAF loops on the Pi 5 GPU. The dt now comes
// from the game-loop's tab-visibility-aware clock for free.
$effect(() =>
	subscribe((dt) =>
		untrack(() => {
			const drift = Math.cos((heading + 180) * Math.PI / 180);
			const dir = Math.abs(drift) > 0.15 ? drift : (drift >= 0 ? 0.2 : -0.2);

			for (const cloud of clouds) {
				cloud.x += cloud.vx * dt * speed * dir;

				if (cloud.x > 130) {
					cloud.x = randomBetween(-30, -18);
					cloud.y = randomBetween(12, 75);
					cloud.z = randomBetween(-500, -80);
					cloud.vx = randomBetween(1.5, 6);
					cloud.baseScale = randomBetween(0.7, 1.5);
				} else if (cloud.x < -30) {
					cloud.x = randomBetween(118, 130);
					cloud.y = randomBetween(12, 75);
					cloud.z = randomBetween(-500, -80);
					cloud.vx = randomBetween(1.5, 6);
					cloud.baseScale = randomBetween(0.7, 1.5);
				}

				for (const s of cloud.sprites) {
					s.rot += s.speed * speed;
				}
			}
		}),
	),
);

// ── Altitude + environment ───────────────────────────────────────────
const CLOUD_DECK = 28000;
const cloudProximity = $derived.by(() => {
	const dist = Math.abs(altitude - CLOUD_DECK);
	if (dist < 4000) return 1.0;
	if (dist > 12000) return 0.3;
	return 1.0 - (dist - 4000) / 8000 * 0.7;
});
// Weather-keyed transparency multiplier with a golden-hour exception.
// Clear weather mid-day → clouds should barely show (terrain + horizon
// read clearly). But at dawn / dusk, even "clear" skies get dramatic
// horizon clouds catching the low-angle sun — letting them breathe
// back up to 55% makes the golden-hour view pop. Non-clear weather
// (cloudy / rain / overcast / storm) stays at full opacity regardless
// of time of day.
const weatherOpacityFactor = $derived.by(() => {
	if (weather !== 'clear') return 1.0;
	if (skyState === 'dawn' || skyState === 'dusk') return 0.55;
	return 0.25;
});

const layerOpacity = $derived.by(() => {
	let d = effectiveDensity;
	if (nightFactor > 0.5) d = Math.max(d, nightCloudFloor);
	// Phase 16: added 0.05 floor to opacity so clouds never truly vanish
	return Math.min(1, (d + 0.05) * cloudProximity * 1.2 * weatherOpacityFactor);
});

// KEEP: altitudeShift drives cloud-deck vertical position — linter must not strip
const altitudeShift = $derived.by(() => {
	const delta = altitude - CLOUD_DECK;
	if (Math.abs(delta) < 2000) return 0;
	// Below deck: clouds shift UP (positive = viewport % down, so negative shifts clouds up)
	// Above deck: clouds shift DOWN (looking down at cloud tops)
	const shift = -delta / 15000 * 15;
	return Math.max(-15, Math.min(12, shift));
});

// Environment-responsive color filter.
// Phase 16: boosted night brightness 0.3 -> 0.45 and saturation 0.05 -> 0.12.
// This ensures clouds stay visible and have a slight cool tint at night.
const envFilter = $derived.by(() => {
	if (nightFactor > 0.6) return 'brightness(0.45) saturate(0.12) hue-rotate(200deg)';
	if (nightFactor > 0.3) return `brightness(${1 - nightFactor * 0.4}) saturate(${(1 - nightFactor * 0.2) * 0.3}) hue-rotate(${nightFactor * 12}deg)`;
	// Golden hour: push warm strongly. Dawn skews yellow-gold; dusk skews
	// orange-red. Sepia + hue-rotate together give a painterly glow rather
	// than a flat tint wash.
	if (skyState === 'dawn') return 'brightness(1.08) saturate(1.25) sepia(0.32) hue-rotate(-8deg)';
	if (skyState === 'dusk') return 'brightness(0.95) saturate(1.3) sepia(0.38) hue-rotate(-14deg)';
	return 'none';
});

// Sprite size in vw — scales with cloudScale prop AND individual cloud baseScale
const baseSpriteVw = $derived(18 * cloudScale);

// Environment edge shadow — CSS drop-shadow tints sprite edges with sky color
const edgeShadowFilter = $derived(`drop-shadow(0 3px 12px ${edgeColor})`);
</script>

<div
	class="css3d-clouds"
	style:opacity={layerOpacity}
	style:filter={envFilter}
	style:transform="translateY({altitudeShift}%) scale({0.85 + (cloudScale ?? 1) * 0.35})"
	style:perspective-origin="50% {42 + altitudeShift * 0.3}%"
	style:--edge-shadow={edgeShadowFilter}
	aria-hidden="true"
>
	{#each clouds as cloud (cloud)}
		<div
			class="cloud-base"
			style:left="{cloud.x}%"
			style:top="{cloud.y}%"
			style:transform="translateZ({cloud.z}px)"
		>
			{#each cloud.sprites as s (s)}
				<img
					class="cloud-sprite"
					src={s.texture}
					alt=""
					style:width="{baseSpriteVw * cloud.baseScale * s.scale}vw"
					style:height="{baseSpriteVw * cloud.baseScale * s.scale}vw"
					style:transform="translate({s.x}vw, {s.y}vw) translateZ({s.z}px) rotateZ({s.rot}deg)"
					style:opacity={s.opacity}
					style:filter="brightness({s.brightness}) var(--edge-shadow)"
					loading="lazy"
				/>
			{/each}
		</div>
	{/each}
</div>

<style>
	.css3d-clouds {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 5;
		overflow: hidden;
		perspective: 1800px;
		will-change: opacity;
		transition: opacity 1.5s ease, filter 2.5s ease;
		/* Horizon-clip gradient mask — the MapLibre-era "bg hack" equivalent.
		   Clouds are only visible ABOVE the horizon line (~45% from top at
		   typical cruise pitch). Below that, the mask goes transparent so
		   the terrain underneath reads as "clipping" the cloud deck, giving
		   the illusion of clouds sitting at the horizon rather than in
		   front of the ground. Top 10% still fades to let the pure sky
		   read through; dense band is 15%–40%; hard fall-off 40%–55%. */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 8%, black 15%, black 40%, rgba(0,0,0,0.35) 50%, transparent 58%);
		mask-image: linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.4) 8%, black 15%, black 40%, rgba(0,0,0,0.35) 50%, transparent 58%);
	}

	.cloud-base {
		position: absolute;
		width: 0;
		height: 0;
		transform-style: preserve-3d;
	}

	.cloud-sprite {
		position: absolute;
		transform-origin: center;
		/* Center on cloud base */
		margin-left: -50%;
		margin-top: -50%;
		will-change: transform;
		/* Normal blend: cloud PNGs have alpha channels for natural transparency.
		   Screen mode washes out against light terrain backgrounds. */
		/* Smooth the per-frame rotation updates */
		transition: filter 2s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.css3d-clouds { display: none; }
	}
</style>
