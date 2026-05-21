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
import { subscribe } from '$lib/game-loop';

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

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function createSprites(count: number, textures: readonly string[]): CloudSprite[] {
	const sprites: CloudSprite[] = [];
	for (let i = 0; i < count; i++) {
		const y = rand(-5, 5);
		sprites.push({
			x: rand(-8, 8),          // vw units — relative to viewport
			y,
			z: rand(-100, 100),
			rot: rand(0, 360),
			scale: rand(0.5, 1.4),
			speed: rand(0.015, 0.08),
			texture: textures[Math.floor(Math.random() * textures.length)],
			opacity: rand(0.55, 0.92),
			// Bottom sprites darker (gray underside), top sprites bright (sunlit)
			brightness: 0.7 + (y + 5) / 10 * 0.35,
		});
	}
	return sprites;
}

// Horizon clouds — translucent haze band at the far horizon (6-22%).
// Lower opacity than mid/foreground so terrain shows THROUGH them,
// not BEHIND them. Real clouds at 30k ft are ABOVE terrain — they
// don't occlude foreground terrain, they BLEND with the sky.
function createHorizonSprites(count: number, textures: readonly string[]): CloudSprite[] {
	const sprites: CloudSprite[] = [];
	for (let i = 0; i < count; i++) {
		const y = rand(-5, 5);
		sprites.push({
			x: rand(-8, 8),
			y,
			z: rand(-80, 80),
			rot: rand(0, 360),
			scale: rand(0.5, 1.3),
			speed: rand(0.01, 0.05),
			texture: textures[Math.floor(Math.random() * textures.length)],
			// KEY: low opacity so terrain shows through — horizon is a haze, not a wall
			opacity: rand(0.18, 0.38),
			brightness: 0.8 + (y + 5) / 10 * 0.2,
		});
	}
	return sprites;
}

function createHorizonCloud(): Cloud {
	const textures = textureSets[weather] ?? textureSets.clear;
	// Phase 10b (user direction): horizon clouds hug the VISIBLE horizon line
	// (~y 42-50% at default cruise pitch -75°) rather than floating high in
	// the sky band (6-22%). This is the "fake clouds at horizon behind the
	// Earth" effect — the deep negative z (-1600..-700) plus the mask in
	// css3d-clouds keeps them feeling far away, while the y-band lands them
	// right above the Earth silhouette where VIIRS city lights are visible.
	// Counts widened so the horizon strip actually reads as a cloud bank.
	return {
		x: rand(-30, 130),
		y: rand(28, 44),
		z: rand(-1600, -700),
		vx: rand(0.4, 1.6),
		baseScale: rand(2.0, 3.6),  // wide but translucent
		sprites: createHorizonSprites(10 + Math.floor(Math.random() * 6), textures),
	};
}

// Mid/foreground clouds — scattered below the horizon deck.
function createCloud(idx: number, total: number): Cloud {
	const textures = textureSets[weather] ?? textureSets.clear;
	const yBand = idx < total * 0.5 ? rand(25, 50) : rand(50, 82);
	return {
		x: rand(-20, 120),
		y: yBand,
		z: rand(-400, -60),
		vx: rand(2, 7),
		baseScale: rand(0.7, 1.5),
		sprites: createSprites(8 + Math.floor(Math.random() * 7), textures),
	};
}

// Phase 10b — horizon count bumped 8→14 so the visible-horizon cloud bank
// reads as continuous when density is high. Mid count slightly lowered
// because horizon clouds now occupy the band mid-clouds previously bled
// into; keep total scene complexity similar.
const horizonCount = $derived(Math.max(6, Math.round(effectiveDensity * 14)));
const midCount = $derived(Math.max(3, Math.round(effectiveDensity * 8)));

let clouds = $state<Cloud[]>([]);
$effect(() => {
	void weather;
	const horizon = Array.from({ length: horizonCount }, () => createHorizonCloud());
	const mid = Array.from({ length: midCount }, (_, i) => createCloud(i, midCount));
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
					cloud.x = rand(-30, -18);
					cloud.y = rand(12, 75);
					cloud.z = rand(-500, -80);
					cloud.vx = rand(1.5, 6);
					cloud.baseScale = rand(0.7, 1.5);
				} else if (cloud.x < -30) {
					cloud.x = rand(118, 130);
					cloud.y = rand(12, 75);
					cloud.z = rand(-500, -80);
					cloud.vx = rand(1.5, 6);
					cloud.baseScale = rand(0.7, 1.5);
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
	return Math.min(1, d * cloudProximity * 1.2 * weatherOpacityFactor);
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
// Phase 15.5 retune: saturate dropped from 0.4 → 0.05 at deep night. The
// Phase 15.5 navy-backdrop shader made the previous hue-rotate(210deg) +
// saturate(0.4) combo read as visible violet/magenta blobs over lit
// terrain. Keeping a slight 200° rotation preserves the cool-moonlight
// intent without saturating into purple.
const envFilter = $derived.by(() => {
	if (nightFactor > 0.6) return 'brightness(0.3) saturate(0.05) hue-rotate(200deg)';
	if (nightFactor > 0.3) return `brightness(${1 - nightFactor * 0.5}) saturate(${(1 - nightFactor * 0.25) * 0.3}) hue-rotate(${nightFactor * 12}deg)`;
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
