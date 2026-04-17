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
import type { WeatherType } from '$lib/types';

let {
	density = 0.75,
	speed = 1.0,
	heading = 90,
	nightFactor = 0,
	altitude = 30000,
	weather = 'clear' as WeatherType,
	cloudScale = 1.0,
	/** Environment edge color — tints cloud edges to match sky/horizon */
	edgeColor = 'rgba(180, 200, 230, 0.3)',
	/** Sky state for color grading */
	skyState = 'day' as string,
}: {
	density?: number;
	speed?: number;
	heading?: number;
	nightFactor?: number;
	altitude?: number;
	weather?: WeatherType;
	cloudScale?: number;
	edgeColor?: string;
	skyState?: string;
} = $props();

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

const textureSets: Record<string, readonly string[]> = {
	clear: ['/cloud.png'],
	cloudy: ['/cloud.png', '/cloud.png'],
	rain: ['/cloud.png', '/cloud-dark.png'],
	overcast: ['/cloud-dark.png', '/cloud-smoke.png'],
	storm: ['/cloud-dark.png', '/cloud-smoke.png'],
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

function createCloud(idx: number, total: number): Cloud {
	const textures = textureSets[weather] ?? textureSets.clear;
	// Cloud deck composition: dense band at horizon (15-45%), sparse below
	const yBand = idx < total * 0.55 ? rand(12, 42) : rand(42, 78);
	return {
		x: rand(-20, 120),
		y: yBand,
		z: rand(-500, -80),
		vx: rand(1.5, 6),
		baseScale: rand(0.7, 1.5),
		sprites: createSprites(8 + Math.floor(Math.random() * 7), textures),
	};
}

const cloudCount = $derived(Math.max(4, Math.round(density * 14)));

let clouds = $state<Cloud[]>([]);
$effect(() => {
	const count = cloudCount;
	void weather;
	clouds = Array.from({ length: count }, (_, i) => createCloud(i, count));
});

// ── Animation loop ───────────────────────────────────────────────────
$effect(() => {
	let raf: number;
	let last = performance.now();

	const loop = (now: number) => {
		const dt = Math.min((now - last) / 1000, 0.1);
		last = now;

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
		});

		raf = requestAnimationFrame(loop);
	};
	raf = requestAnimationFrame(loop);
	return () => cancelAnimationFrame(raf);
});

// ── Altitude + environment ───────────────────────────────────────────
const CLOUD_DECK = 28000;
const cloudProximity = $derived.by(() => {
	const dist = Math.abs(altitude - CLOUD_DECK);
	if (dist < 4000) return 1.0;
	if (dist > 12000) return 0.3;
	return 1.0 - (dist - 4000) / 8000 * 0.7;
});
const layerOpacity = $derived(Math.min(1, density * cloudProximity * 1.2));

// Environment-responsive color filter
const envFilter = $derived.by(() => {
	if (nightFactor > 0.6) return 'brightness(0.35) saturate(0.4) hue-rotate(210deg)';
	if (nightFactor > 0.3) return `brightness(${1 - nightFactor * 0.5}) saturate(${1 - nightFactor * 0.25}) hue-rotate(${nightFactor * 30}deg)`;
	if (skyState === 'dawn') return 'brightness(1.05) saturate(1.1) sepia(0.15)';
	if (skyState === 'dusk') return 'brightness(0.9) saturate(1.2) sepia(0.2) hue-rotate(-10deg)';
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
	style:--edge-shadow={edgeShadowFilter}
	aria-hidden="true"
>
	{#each clouds as cloud, ci (ci)}
		<div
			class="cloud-base"
			style:left="{cloud.x}%"
			style:top="{cloud.y}%"
			style:transform="translateZ({cloud.z}px)"
		>
			{#each cloud.sprites as s, si (si)}
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
		perspective: 900px;
		perspective-origin: 50% 42%;
		will-change: opacity;
		transition: opacity 1.5s ease, filter 2.5s ease;
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 82%, transparent 100%);
		mask-image: linear-gradient(to bottom, transparent 0%, black 6%, black 82%, transparent 100%);
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
		/* Screen blend: overlapping sprites add brightness naturally */
		mix-blend-mode: screen;
		/* Smooth the per-frame rotation updates */
		transition: filter 2s ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.css3d-clouds { display: none; }
	}
</style>
