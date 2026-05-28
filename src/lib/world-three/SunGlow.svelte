<script lang="ts">
	/**
	 * SunGlow — sun core + atmospheric scatter halo, both as additive
	 * billboards at the sun's world direction.
	 *
	 * Two sprites stacked at the same position:
	 *   1. CORE   — small bright disk, programmatic radial gradient
	 *               texture, peaks white-hot, falls off to warm amber.
	 *               This is "the sun."
	 *   2. HALO   — much larger soft sprite at same position, low
	 *               opacity. This is "atmospheric scatter" — the bloom
	 *               + diffraction that real cameras + eyes pick up at
	 *               horizon angles. Gives the painterly horizon glow
	 *               Cesium's analytical atmosphere doesn't quite hit.
	 *
	 * Texture is generated procedurally via a 2D Canvas radial gradient
	 * (no PNG asset needed). Disposed on unmount.
	 *
	 * Drives the dawn / dusk hero moment of the composition.
	 */
	import { T } from '@threlte/core';
	import { AdditiveBlending, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, sunVisibility, skyMood, SKY_PALETTE } from './sky';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();

	// 60 000 km radial distance from origin — inside camera.far (1e9)
	// but past every other Three-side scene asset so the sun stays
	// behind the clouds in depth order.
	const SUN_PLACEMENT_M = 6e7;
	// Core sprite — 5 000 km @ 60 000 km radial → ~4.8° subtended angle.
	// Real sun is ~0.5°; 4.8° trades realism for visual weight so the
	// passenger window actually FEELS sunlit at horizon angles.
	const CORE_SIZE_M = 5e6;
	// Halo 5× the core — diffuse atmospheric scatter ring.
	const HALO_SIZE_M = CORE_SIZE_M * 5;

	const sunPos = $derived.by<[number, number, number]>(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		return [d[0] * SUN_PLACEMENT_M, d[1] * SUN_PLACEMENT_M, d[2] * SUN_PLACEMENT_M];
	});

	// Visibility + per-phase palette — both pulled from sky.ts so SunGlow,
	// LensFlare, and AtmosphericVeil share the same dawn/dusk windows.
	const visibility = $derived(sunVisibility(model.timeOfDay));
	const sunColor = $derived(SKY_PALETTE.sunCore[skyMood(model.timeOfDay).phase]);

	const coreTint = $derived.by(() => {
		// Base from palette (warm at dawn/dusk). Extra warm shift when air mass high.
		const r = Math.min(1, sunColor[0] + warmShift * 0.22);
		const g = Math.max(0.22, sunColor[1] - warmShift * 0.38);
		const b = Math.max(0.12, sunColor[2] - warmShift * 0.52);
		return new Color(r, g, b);
	});
	const haloTint = $derived(new Color(
		sunColor[0] * 0.95,
		sunColor[1] * 0.70,
		sunColor[2] * 0.50,
	));

	// Air mass (secant approximation) + real light intensity.
	// Tighter epsilon → higher peak values near horizon for dramatic
	// core dimming + halo bloom when the sun is low (thick atmosphere).
	// Blended with nightFactor so the artistic glow respects scene light strength.
	const airMassFactor = $derived.by(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		const elev = Math.max(-0.12, Math.min(1, d[1]));
		return 1.0 / Math.max(0.12, elev + 0.12);
	});

	// Blend air mass with sun strength from nightFactor (real directional light proxy)
	const sunStrength = $derived(1 - model.nightFactor * 0.72);
	const lowSunFactor = $derived(Math.min(4.2, airMassFactor * 0.58 * sunStrength));

	// Extra warm shift + core dim when air mass is high (low sun elevation).
	// Makes the core itself feel "through more atmosphere" — warmer and softer.
	const warmShift = $derived(Math.min(0.85, (airMassFactor - 1.0) * 0.18 * sunStrength));

	// Programmatic radial gradient — sun core. Module-level since the
	// texture is content-static; reactive parts are tint + opacity above.
	const coreTexture = makeRadialTexture([
		[0.00, 'rgba(255, 255, 255, 1.0)'],
		[0.15, 'rgba(255, 245, 215, 0.92)'],
		[0.35, 'rgba(255, 200, 130, 0.55)'],
		[0.60, 'rgba(255, 140, 60, 0.18)'],
		[1.00, 'rgba(0, 0, 0, 0)'],
	]);

	// Softer, broader gradient — scatter halo.
	const haloTexture = makeRadialTexture([
		[0.00, 'rgba(255, 220, 180, 0.45)'],
		[0.35, 'rgba(255, 180, 110, 0.22)'],
		[0.70, 'rgba(255, 120, 60, 0.06)'],
		[1.00, 'rgba(0, 0, 0, 0)'],
	]);

	// Cleanup
	$effect(() => () => {
		coreTexture.dispose();
		haloTexture.dispose();
	});
</script>

<!-- Halo first (rendered behind core thanks to lower depth-test priority
     after both have depthWrite false; sprite render-order also handles
     this since they're at the same position). -->
<T.Sprite
	position={sunPos}
	scale={[HALO_SIZE_M * (1 + lowSunFactor * 0.68), HALO_SIZE_M * (1 + lowSunFactor * 0.68), 1]}
	renderOrder={0}
>
	<T.SpriteMaterial
		map={haloTexture}
		color={haloTint}
		// Air-mass emphasis: dramatically stronger scatter bloom near horizon.
		opacity={visibility * (0.72 + lowSunFactor * 0.38) * (1 + Math.min(0.9, (airMassFactor - 1) * 0.12))}
		transparent
		depthWrite={false}
		depthTest={false}
		blending={AdditiveBlending}
	/>
</T.Sprite>

<T.Sprite
	position={sunPos}
	scale={[CORE_SIZE_M, CORE_SIZE_M, 1]}
	renderOrder={1}
>
	<T.SpriteMaterial
		map={coreTexture}
		color={coreTint}
		// Core dims harder + gets extra warm tint (via coreTint) when low in sky.
		opacity={visibility * (0.93 - lowSunFactor * 0.29)}
		transparent
		depthWrite={false}
		depthTest={false}
		blending={AdditiveBlending}
	/>
</T.Sprite>
