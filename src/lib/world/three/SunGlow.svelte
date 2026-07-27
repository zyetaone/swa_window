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
	import { T, useTask } from '@threlte/core';
	import { AdditiveBlending, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, airMassFactor, SUN_PLACEMENT_M } from '$lib/world/sky';
	import { lightingState } from '$lib/world/curves';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();

	// SUN_PLACEMENT_M now imported from sky.ts (shared with LensFlare,
	// EffectStack GodRays source, and Moon's anti-sun mirror).
	// Core sprite — 1 800 km @ 60 000 km radial → ~1.7° subtended angle.
	// Real sun is ~0.5°; 1.7° is the smallest size that still reads as
	// "sun in the window" without the 4.8°-disc "drawn sun" feel.
	// Dropped from 5e6 → 1.8e6 because users reported the larger disc
	// looked illustrated. Halo + bloom carry the perceptual weight now.
	const CORE_SIZE_M = 1.8e6;
	// Halo 8× the core — diffuse atmospheric scatter. Larger so the
	// transition out is gradual; opacity is correspondingly lower.
	const HALO_SIZE_M = CORE_SIZE_M * 8;

	const sunPos = $derived.by<[number, number, number]>(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		return [d[0] * SUN_PLACEMENT_M, d[1] * SUN_PLACEMENT_M, d[2] * SUN_PLACEMENT_M];
	});

	// Visibility + colour now come from the unified lighting SSOT:
	// sunGlowVisibility owns the curve sky.ts `sunVisibility` used to, and
	// `horizonTint` is the CONTINUOUS sun-core blend (no hard phase switch).
	// airMass uses the SHARED sky.ts helper — the duplicated local copy is gone,
	// so SunGlow / Moon / NightStars all read one air-mass formula.
	const visibility = $derived(lightingState(model.timeOfDay, model.nightFactor).sunGlowVisibility);
	// airMassFactor is now latitude + time driven (real local solar elevation
	// via sunElevationSin) — previously it read the constant sunDir[1] and
	// returned ~1.965 for every input, freezing warmShift/shimmer mid-state.
	const airMass = $derived(airMassFactor(model.flight.camLat, model.timeOfDay));

	// Blend air mass with sun strength from nightFactor (real directional light proxy)
	const sunStrength = $derived(1 - model.nightFactor * 0.72);
	const lowSunFactor = $derived(Math.min(4.2, airMass * 0.58 * sunStrength));

	// Extra warm shift + core dim when air mass is high (low sun elevation).
	const warmShift = $derived(Math.min(0.85, (airMass - 1.0) * 0.18 * sunStrength));

	// Pre-allocated scratch Colors mutated in place each frame (same pattern as
	// ThreeOverlay's _ambientTintScratch) — these $derived fire every frame during
	// flight, so `new Color()` here was two heap allocations/frame of GC pressure.
	// Threlte's colour reconciler reads .r/.g/.b directly, so mutate-in-place
	// propagates. (s = the shared lightingState object — read synchronously here.)
	const _coreTintScratch = new Color();
	const coreTint = $derived.by(() => {
		const s = lightingState(model.timeOfDay, model.nightFactor);
		const r = Math.min(1, s.horizonTint[0] + warmShift * 0.22);
		const g = Math.max(0.22, s.horizonTint[1] - warmShift * 0.38);
		const b = Math.max(0.12, s.horizonTint[2] - warmShift * 0.52);
		return _coreTintScratch.setRGB(r, g, b);
	});
	const _haloTintScratch = new Color();
	const haloTint = $derived.by(() => {
		const s = lightingState(model.timeOfDay, model.nightFactor);
		return _haloTintScratch.setRGB(s.horizonTint[0] * 0.95, s.horizonTint[1] * 0.70, s.horizonTint[2] * 0.50);
	});

	// Programmatic radial gradient — sun core. Smoothed: fewer hard color
	// stops in the falloff band so there's no visible "ring" between
	// stops. Single white-hot peak, long tail to transparent. Was 4
	// discrete stops with big alpha jumps (1.0→0.92→0.55→0.18→0) which
	// produced visible banding rings reading as "drawn sun."
	const coreTexture = makeRadialTexture([
		[0.00, 'rgba(255, 255, 255, 1.0)'],
		[0.18, 'rgba(255, 250, 230, 0.78)'],
		[0.55, 'rgba(255, 215, 165, 0.18)'],
		[1.00, 'rgba(255, 180, 110, 0)'],
	]);

	// Halo — long-tail scatter. Lower base opacity than before (0.45→0.22)
	// to disappear cleanly into the sky; larger radial extent compensates.
	const haloTexture = makeRadialTexture([
		[0.00, 'rgba(255, 225, 195, 0.22)'],
		[0.45, 'rgba(255, 195, 140, 0.08)'],
		[1.00, 'rgba(255, 150, 90, 0)'],
	]);

	// Atmospheric heat-haze shimmer — slight brightness wobble on sun
	// halo when sun is low (thick air mass refraction). Multi-frequency
	// pseudo-noise from sine combinations: large slow wave + smaller
	// faster jitter. Magnitude scales with lowSunFactor so noon sun is
	// perfectly steady, sunset sun has visible shimmer.
	let _shimT = $state(0);
	useTask((dt) => { _shimT += dt; });
	const shimmer = $derived.by(() => {
		const lowSun = lowSunFactor;
		if (lowSun < 0.4) return 1;
		const t = _shimT;
		const n = 0.5 * Math.sin(t * 6.3) + 0.3 * Math.cos(t * 11.7) + 0.2 * Math.sin(t * 19.1);
		return 1 + n * 0.045 * Math.min(1, (lowSun - 0.4) * 0.6);
	});

	// Cleanup
	$effect(() => () => {
		coreTexture.dispose();
		haloTexture.dispose();
	});
</script>

<!-- Halo first (rendered behind core thanks to lower depth-test priority
     after both have depthWrite false; sprite render-order also handles
     this since they're at the same position).
     depthTest ON for both sprites: built-in SpriteMaterial handles the log
     depth buffer, so the wing's depth writes occlude the sun glow (clouds
     are depthWrite:false and never occlude). -->
<!-- Halo growth 0.5 → 0.25 per lowSunFactor unit: at the sunset maximum
     (lowSunFactor ~3.3) the old factor inflated the halo to ~38° of sky —
     a dome, not a glow. ~26° keeps the painterly horizon wash. -->
<T.Sprite
	position={sunPos}
	scale={[HALO_SIZE_M * (1 + lowSunFactor * 0.25), HALO_SIZE_M * (1 + lowSunFactor * 0.25), 1]}
	renderOrder={0}
>
	<T.SpriteMaterial
		map={haloTexture}
		color={haloTint}
		// Air-mass emphasis: stronger scatter near horizon, but dialed back
		// (0.72→0.5 base, 0.38→0.24 low-sun boost) — the old values stacked
		// with the bloom pass into a hot white blob at dusk.
		// Capped at 0.55 (evening recalibration): with the front-loaded
		// sunGlowVisibility curve the uncapped product saturated to 1.0 at
		// sunset and the halo read as a nuclear dome, not a calm sunset glow.
		opacity={Math.min(0.55, visibility * (0.5 + lowSunFactor * 0.24) * (1 + Math.min(0.9, (airMass - 1) * 0.12)) * shimmer)}
		transparent
		depthWrite={false}
		depthTest={true}
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
		// max(0, …): lowSunFactor > 3.2 drove this NEGATIVE at the horizon —
		// a negative opacity SUBTRACTS under additive blending and painted a
		// black square over the sunset glow.
		opacity={Math.max(0, visibility * (0.93 - lowSunFactor * 0.29))}
		transparent
		depthWrite={false}
		depthTest={true}
		blending={AdditiveBlending}
	/>
</T.Sprite>
