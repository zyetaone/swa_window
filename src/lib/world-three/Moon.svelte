<script lang="ts">
	/**
	 * Moon — pale disk + soft halo at the anti-sun world direction.
	 *
	 * Geometric simplification: moon position = −sunDirection × placement.
	 * That's not a real lunar orbit, but it gives the "moon comes out at
	 * night" behaviour passengers expect — sun on one horizon, moon on the
	 * other. When the sun is below the kiosk's local horizon (night), the
	 * moon is above it; visibility is gated by `model.nightFactor` so it
	 * fades in only when the night palette is asserted.
	 *
	 * Texture is a procedural CanvasTexture — bright cool-white core with
	 * a soft falloff, mirroring SunGlow's shape but cooler. No PNG asset.
	 *
	 * Cesium's built-in `viewer.scene.moon` is turned off in
	 * `src/lib/world/compose.ts` so we don't double-render the lunar disk.
	 */
	import { T } from '@threlte/core';
	import { AdditiveBlending, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection } from './sky';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();

	// Same placement radius as SunGlow so the moon sits at the same shell
	// behind clouds in depth order. Anti-sun direction → opposite side of
	// the sky from the sun.
	const MOON_PLACEMENT_M = 6e7;
	// Slightly smaller than sun core — real angular size is about the same
	// as the sun (~0.5°) but a 4× disc reads better at passenger-window FOV.
	const MOON_CORE_SIZE_M = 4e6;
	const MOON_HALO_SIZE_M = MOON_CORE_SIZE_M * 4;

	const moonPos = $derived.by<[number, number, number]>(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		// Negate to land on the anti-sun side.
		return [-d[0] * MOON_PLACEMENT_M, -d[1] * MOON_PLACEMENT_M, -d[2] * MOON_PLACEMENT_M];
	});

	// Visibility — fades in with night + gets a realistic horizon boost when
	// the moon (anti-sun) is low. Mirrors the air-mass treatment on the sun
	// side layers so moonrise/moonset feel grounded in the same 3D sky.
	const airMassFactor = $derived.by(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		// Moon is at -sunDir, so its "elevation" for scatter is the negative y.
		const moonElev = Math.max(-0.12, Math.min(1, -d[1]));
		return 1.0 / Math.max(0.12, moonElev + 0.12);
	});

	const moonVisibility = $derived.by(() => {
		const nfGate = Math.max(0, model.nightFactor - 0.15) * 1.18;
		// Mild horizon emphasis — moon brightens as it nears the horizon line.
		const horizonBoost = 1 + Math.min(0.9, (airMassFactor - 1) * 0.22);
		return nfGate * horizonBoost;
	});

	// Pale cool-white. Slight blue cast for the halo to read as "moonglow."
	const coreTint = new Color(0.92, 0.94, 1.0);
	const haloTint = new Color(0.55, 0.62, 0.85);

	// Core: sharp cool-white disk with crisp falloff — reads as the moon itself.
	const coreTexture = makeRadialTexture([
		[0.00, 'rgba(255, 255, 255, 1.0)'],
		[0.18, 'rgba(245, 248, 255, 0.95)'],
		[0.40, 'rgba(220, 230, 255, 0.45)'],
		[0.70, 'rgba(180, 200, 240, 0.10)'],
		[1.00, 'rgba(0, 0, 0, 0)'],
	]);

	// Halo: very soft cool-blue ring — atmospheric scatter around the moon.
	const haloTexture = makeRadialTexture([
		[0.00, 'rgba(200, 220, 255, 0.35)'],
		[0.40, 'rgba(170, 190, 230, 0.14)'],
		[0.80, 'rgba(140, 160, 200, 0.04)'],
		[1.00, 'rgba(0, 0, 0, 0)'],
	]);

	$effect(() => () => {
		coreTexture.dispose();
		haloTexture.dispose();
	});
</script>

<!-- Halo behind core. Both depthTest false so they always read in front. -->
<T.Sprite
	position={moonPos}
	scale={[MOON_HALO_SIZE_M, MOON_HALO_SIZE_M, 1]}
	renderOrder={0}
>
	<T.SpriteMaterial
		map={haloTexture}
		color={haloTint}
		opacity={moonVisibility * 0.65}
		transparent
		depthWrite={false}
		depthTest={false}
		blending={AdditiveBlending}
	/>
</T.Sprite>

<T.Sprite
	position={moonPos}
	scale={[MOON_CORE_SIZE_M, MOON_CORE_SIZE_M, 1]}
	renderOrder={1}
>
	<T.SpriteMaterial
		map={coreTexture}
		color={coreTint}
		opacity={moonVisibility * 0.95}
		transparent
		depthWrite={false}
		depthTest={false}
		blending={AdditiveBlending}
	/>
</T.Sprite>
