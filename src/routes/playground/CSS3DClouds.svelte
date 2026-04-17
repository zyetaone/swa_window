<script lang="ts">
/**
 * CSS3DClouds — Volumetric clouds via stacked PNG sprites in CSS 3D space.
 *
 * Technique: Jaume Sánchez (spite) — https://www.clicktorelease.com/code/css3dclouds/
 * Adapted for airplane window passenger view.
 *
 * Each cloud = 1 cloudBase div + 6-12 semi-transparent PNG <img> sprites
 * stacked at slightly different Z-depths with random rotation/scale.
 * Multiple overlapping alpha-blended sprites create volumetric appearance.
 *
 * 100% GPU-composited CSS transforms — no SVG filters, no WebGL, no canvas.
 * Lightest possible CPU load. Perfect for Pi 5 24/7.
 *
 * Billboard trick: each sprite counter-rotates to face the camera, creating
 * real parallax depth as the heading/pitch changes.
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
}: {
	density?: number;
	speed?: number;
	heading?: number;
	nightFactor?: number;
	altitude?: number;
	weather?: WeatherType;
	cloudScale?: number;
} = $props();

// ── Cloud generation ─────────────────────────────────────────────────

interface CloudSprite {
	x: number;      // px offset from cloud center
	y: number;
	z: number;      // depth offset within cloud
	rot: number;    // rotateZ degrees — slowly animates
	scale: number;
	speed: number;  // rotation speed (deg/frame)
	texture: string;
	opacity: number;
}

interface Cloud {
	x: number;      // % position on screen
	y: number;
	z: number;      // translateZ for parallax depth
	vx: number;     // horizontal drift speed (%/s)
	sprites: CloudSprite[];
}

// Texture selection based on weather
const textureSets = {
	clear: ['/cloud.png'],
	cloudy: ['/cloud.png', '/cloud.png'],
	rain: ['/cloud.png', '/cloud-dark.png'],
	overcast: ['/cloud-dark.png', '/cloud-smoke.png'],
	storm: ['/cloud-dark.png', '/cloud-smoke.png'],
} as const;

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function createSprites(count: number, textures: readonly string[]): CloudSprite[] {
	const sprites: CloudSprite[] = [];
	for (let i = 0; i < count; i++) {
		sprites.push({
			x: rand(-60, 60),
			y: rand(-40, 40),
			z: rand(-80, 80),
			rot: rand(0, 360),
			scale: rand(0.4, 1.2),
			speed: rand(0.02, 0.12),
			texture: textures[Math.floor(Math.random() * textures.length)],
			opacity: rand(0.5, 0.9),
		});
	}
	return sprites;
}

function createCloud(idx: number, total: number): Cloud {
	const textures = textureSets[weather] ?? textureSets.clear;
	// Distribute clouds vertically: more at horizon (20-45%), fewer below
	const yBand = idx < total * 0.6 ? rand(15, 45) : rand(45, 80);
	return {
		x: rand(-15, 115),
		y: yBand,
		z: rand(-600, -100),     // far = more parallax
		vx: rand(2, 8),          // %/s drift speed
		sprites: createSprites(6 + Math.floor(Math.random() * 7), textures),
	};
}

// Cloud count scales with density
const cloudCount = $derived(Math.max(3, Math.round(density * 12)));

// Initialize cloud pool
let clouds = $state<Cloud[]>([]);
$effect(() => {
	const count = cloudCount;
	// Re-create pool when density or weather type changes
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
				// Horizontal drift
				cloud.x += cloud.vx * dt * speed * dir;

				// Wrap at edges — respawn with new properties
				if (cloud.x > 125) {
					cloud.x = rand(-25, -15);
					cloud.y = rand(15, 75);
					cloud.z = rand(-600, -100);
					cloud.vx = rand(2, 8);
				} else if (cloud.x < -25) {
					cloud.x = rand(115, 125);
					cloud.y = rand(15, 75);
					cloud.z = rand(-600, -100);
					cloud.vx = rand(2, 8);
				}

				// Sprites slowly rotate for organic morphing
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

// ── Altitude-responsive ──────────────────────────────────────────────
const CLOUD_DECK = 28000;
const cloudProximity = $derived.by(() => {
	const dist = Math.abs(altitude - CLOUD_DECK);
	if (dist < 4000) return 1.0;
	if (dist > 12000) return 0.3;
	return 1.0 - (dist - 4000) / 8000 * 0.7;
});
const layerOpacity = $derived(Math.min(1, density * cloudProximity * 1.2));

// Night tint
const tintFilter = $derived.by(() => {
	if (nightFactor > 0.5) return 'brightness(0.4) saturate(0.5) hue-rotate(200deg)';
	if (nightFactor > 0.2) return `brightness(${1 - nightFactor * 0.6}) saturate(${1 - nightFactor * 0.3})`;
	return 'none';
});

// Scale multiplier from cloudScale prop
const sizeMultiplier = $derived(180 * cloudScale);
</script>

<div
	class="css3d-clouds"
	style:opacity={layerOpacity}
	style:filter={tintFilter}
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
					width={sizeMultiplier}
					height={sizeMultiplier}
					style:transform="translateX({s.x}px) translateY({s.y}px) translateZ({s.z}px) rotateZ({s.rot}deg) scale({s.scale})"
					style:opacity={s.opacity}
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
		/* 3D perspective — clouds at different Z feel at different depths */
		perspective: 800px;
		perspective-origin: 50% 45%;
		will-change: opacity;
		transition: opacity 1.5s ease, filter 2s ease;
		/* Gradient mask — fade at top and bottom edges */
		-webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 80%, transparent 100%);
		mask-image: linear-gradient(to bottom, transparent 0%, black 8%, black 80%, transparent 100%);
	}

	.cloud-base {
		position: absolute;
		width: 0;
		height: 0;
		/* preserve-3d so child sprites exist in 3D space */
		transform-style: preserve-3d;
	}

	.cloud-sprite {
		position: absolute;
		/* Center the sprite on the cloud base point */
		transform-origin: center;
		margin-left: -50%;
		margin-top: -50%;
		/* GPU-composited — no CPU paint */
		will-change: transform;
		/* Soft blending of overlapping sprites */
		mix-blend-mode: screen;
	}

	@media (prefers-reduced-motion: reduce) {
		.css3d-clouds { display: none; }
	}
</style>
