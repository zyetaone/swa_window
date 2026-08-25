<script lang="ts">
	/**
	 * Sky — Unified Circadian Atmosphere, Sky Dome, Solar Radiance & Night Starfield.
	 *
	 * Unifies:
	 * 1. MapLibre 3D Sky Dome (<SkyDome>): Rayleigh scattering, horizon mist band,
	 *    and terrain distance fog.
	 * 2. Circadian Celestial Layer: Solar flare radiance at dusk/dawn, and deep space
	 *    starfield with Milky Way at night, fully synchronized with `display.sun`,
	 *    `display.night`, and local destination solar time.
	 */
	import { Sky as SkyDome } from 'svelte-maplibre-gl';
	import { useDisplay } from '../display.svelte.js';

	const display = useDisplay();

	function lerp(a: number, b: number, t: number): number {
		return a + (b - a) * t;
	}

	function lerpRgb(
		a: readonly [number, number, number],
		b: readonly [number, number, number],
		t: number
	): [number, number, number] {
		return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
	}

	const rgb = (c: readonly [number, number, number], a = 1) =>
		`rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

	const night = $derived(display.night ?? 0);
	const sunElev = $derived(display.sun.elevationDeg ?? 30);
	const sunAzimuth = $derived(display.sun.azimuthDeg ?? 180);
	const bank = $derived(display.view.bankDeg ?? 0);
	const pitch = $derived(display.config.pitchDeg ?? -10);

	// ── 1. Circadian & Solar-Graded Sky Vault Colors ──────────────────────────
	const skyTop = $derived.by(() => {
		const base = display.atmosphere.skyTop;
		const elev = sunElev;
		const dusk = Math.max(0, Math.min(1, (12 - Math.abs(elev)) / 12));

		const duskSky: readonly [number, number, number] = [0.22, 0.12, 0.32];
		const nightSky: readonly [number, number, number] = [0.01, 0.02, 0.06];

		const duskBlended = lerpRgb(base, duskSky, dusk * 0.65);
		return lerpRgb(duskBlended, nightSky, night);
	});

	const skyHorizon = $derived.by(() => {
		const base = display.atmosphere.skyHorizon;
		const elev = sunElev;
		const dusk = Math.max(0, Math.min(1, (15 - elev) / 15));

		const duskHorizon: readonly [number, number, number] = [0.85, 0.42, 0.18];
		const nightHorizon: readonly [number, number, number] = [0.03, 0.06, 0.14];

		const duskBlended = lerpRgb(base, duskHorizon, dusk * (1 - night));
		return lerpRgb(duskBlended, nightHorizon, night);
	});

	const fogColor = $derived.by(() => {
		const base = display.atmosphere.skyHorizon;
		const dayFog: readonly [number, number, number] = [0.76, 0.86, 0.96];
		const nightFog: readonly [number, number, number] = [0.04, 0.07, 0.15];

		const blendedDay = lerpRgb(base, dayFog, 0.45);
		return lerpRgb(blendedDay, nightFog, night);
	});

	const groundBlend = $derived(
		Math.max(0.65, Math.min(0.95, display.atmosphere.fogDensity * 2400))
	);

	// ── 2. Celestial Starfield & Solar Radiance ──────────────────────────────
	interface Star {
		x: number;
		y: number;
		size: number;
		opacity: number;
		twinkleDuration: number;
		twinkleDelay: number;
	}

	const STARS: Star[] = Array.from({ length: 140 }, (_, i) => {
		const seed = (i * 9301 + 49297) % 233280;
		const rand1 = seed / 233280;
		const rand2 = ((seed * 9301 + 49297) % 233280) / 233280;
		const rand3 = ((seed * 1337 + 7919) % 233280) / 233280;

		return {
			x: rand1 * 100,
			y: rand2 * 75,
			size: rand3 > 0.85 ? 2.2 : rand3 > 0.5 ? 1.5 : 0.9,
			opacity: 0.35 + rand3 * 0.65,
			twinkleDuration: 2.0 + rand1 * 3.0,
			twinkleDelay: rand2 * 4.0
		};
	});

	const duskFactor = $derived(Math.max(0, Math.min(1, (12 - Math.abs(sunElev)) / 12)));
	const sunHeadingDelta = $derived(
		((sunAzimuth - (display.view.cameraBearingDeg ?? 0) + 540) % 360) - 180
	);
	const sunScreenX = $derived(50 + (sunHeadingDelta / 180) * 50);
</script>

<!-- MapLibre 3D Sky Dome, Rayleigh Haze & Horizon Mist -->
<SkyDome
	sky-color={rgb(skyTop)}
	horizon-color={rgb(skyHorizon)}
	fog-color={rgb(fogColor)}
	sky-horizon-blend={0.75}
	horizon-fog-blend={0.82}
	fog-ground-blend={groundBlend}
	atmosphere-blend={0.85}
/>

<!-- Circadian Celestial Layer: Solar Radiance & Night Starfield -->
<div
	class="sky-celestial-overlay"
	style:--night={night}
	style:--dusk={duskFactor}
	style:--sun-x="{sunScreenX}%"
	style:--view-pitch="{pitch}deg"
	style:--view-bank="{bank * 0.4}deg"
	aria-hidden="true"
>
	<!-- Golden Hour Solar Flare Radiance -->
	{#if duskFactor > 0.05}
		<div class="dusk-radiance" style:opacity={duskFactor * (1 - night)}></div>
	{/if}

	<!-- Deep Space Milky Way & Starfield (Fades in at night) -->
	<div class="starfield" style:opacity={night}>
		<div class="milky-way"></div>
		{#each STARS as star}
			<div
				class="star"
				style:left="{star.x}%"
				style:top="{star.y}%"
				style:width="{star.size}px"
				style:height="{star.size}px"
				style:--base-op={star.opacity}
				style:animation-duration="{star.twinkleDuration}s"
				style:animation-delay="{star.twinkleDelay}s"
			></div>
		{/each}
	</div>
</div>

<style>
	.sky-celestial-overlay {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		z-index: 1;
		transform: rotate(var(--view-bank));
		transform-origin: center center;
		transition: transform 0.1s ease-out;
	}

	.dusk-radiance {
		position: absolute;
		bottom: 20%;
		left: var(--sun-x);
		width: 140vw;
		height: 60vh;
		translate: -50% 50%;
		background: radial-gradient(
			ellipse at center,
			rgba(255, 140, 40, 0.75) 0%,
			rgba(240, 90, 60, 0.45) 35%,
			rgba(140, 40, 110, 0.2) 65%,
			transparent 85%
		);
		filter: blur(24px);
		pointer-events: none;
	}

	.starfield {
		position: absolute;
		inset: 0;
		transition: opacity 0.6s ease;
	}

	.milky-way {
		position: absolute;
		top: -20%;
		left: 10%;
		width: 120%;
		height: 100%;
		rotate: -35deg;
		background: radial-gradient(
			ellipse 80% 30% at 50% 50%,
			rgba(130, 160, 220, 0.18) 0%,
			rgba(90, 120, 180, 0.08) 45%,
			transparent 75%
		);
		filter: blur(32px);
	}

	.star {
		position: absolute;
		border-radius: 50%;
		background: #ffffff;
		box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
		animation: star-twinkle infinite ease-in-out alternate;
	}

	@keyframes star-twinkle {
		0% {
			opacity: calc(var(--base-op) * 0.35);
			transform: scale(0.8);
		}
		50% {
			opacity: var(--base-op);
			transform: scale(1.15);
		}
		100% {
			opacity: calc(var(--base-op) * 0.6);
			transform: scale(0.9);
		}
	}
</style>
