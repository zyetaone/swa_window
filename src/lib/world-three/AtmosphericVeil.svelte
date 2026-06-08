<script lang="ts">
	/**
	 * AtmosphericVeil — soft, very large radial sprite at the sun's world
	 * direction. Paints the diffuse atmosphere mood that Cesium's
	 * analytical Hosek-Wilkie shader gestures at but doesn't fully render
	 * at the cruise viewing angle.
	 *
	 * Conceptually the "third tier" beyond SunGlow's core + halo — even
	 * larger, even softer, sits BEHIND SunGlow in render order.
	 *
	 * Visibility curve + palette come from world-three/sky.ts (shared with
	 * SunGlow + LensFlare so all three sun-anchored layers ramp together).
	 */
	import { T, useTask } from '@threlte/core';
	import { AdditiveBlending, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, airMassFactor, sunVisibility, skyMood, SKY_PALETTE } from './sky';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();

	const VEIL_PLACEMENT_M = 1.2e8;
	const VEIL_SIZE_M = 1.0e8;

	const veilPos = $derived.by<[number, number, number]>(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		return [
			d[0] * VEIL_PLACEMENT_M,
			d[1] * VEIL_PLACEMENT_M,
			d[2] * VEIL_PLACEMENT_M,
		];
	});

	const veilColor = $derived.by(() => {
		const rgb = SKY_PALETTE.veil[skyMood(model.timeOfDay).phase];
		return new Color(rgb[0], rgb[1], rgb[2]);
	});

	// Uses the shared airMassFactor from sky.ts for consistency across
	// all artistic sky layers. The big soft veil now feels dramatically
	// stronger near the horizon (thicker atmosphere path).


	// Strongest at dawn/dusk (×0.32) and now boosted by air mass near the
	// horizon. Residual daytime (0.10), faint at night (0.03). The airMass
	// term gives the "painterly scatter" that passengers actually see at
	// low sun angles.
	// Slow breathing — solar prominence / atmospheric wave throb. Slowest
	// of the randomization patterns: 0.018 + 0.031 + 0.013 Hz frequencies
	// give a periodicity of ~10s with quasi-random envelope. ±8% magnitude.
	let _veilT = $state(0);
	useTask((dt) => { _veilT += dt; });
	const veilBreath = $derived.by(() => {
		const t = _veilT;
		const n = 0.5 * Math.sin(t * 0.018) + 0.3 * Math.cos(t * 0.031) + 0.2 * Math.sin(t * 0.013);
		return 1 + n * 0.08;
	});

	const veilOpacity = $derived.by(() => {
		const phase = skyMood(model.timeOfDay).phase;
		// Day: track solar arc so the veil responds to sun elevation,
		// not a flat constant. Coefficient chosen so midday ≈ original 0.10.
		// Floor at 0.10 because sunVisibility() has discontinuities at the
		// dawn-day boundary (t=8) and day-dusk boundary (t=17) where it
		// momentarily drops to 0 before jumping to the 0.35 day plateau.
		// Without the floor those discontinuities produce a brief visible
		// dip-then-snap on the veil opacity right at 08:00 / 17:00.
		if (phase === 'day')   return Math.max(0.10, 0.29 * sunVisibility(model.timeOfDay)) * veilBreath;
		// Natural-night pass: lifted 0.03 → 0.06 so the upper sky carries a
		// faint blue wash instead of pure black. Bridges the contrast gap
		// between the (now softer) horizon limb and the sky proper.
		if (phase === 'night') return 0.06 * veilBreath;
		const base = sunVisibility(model.timeOfDay) * 0.32;
		// Strong horizon emphasis (up to ~2.5× at true horizon).
		const am = airMassFactor(model.flight.camLon, model.timeOfDay);
		return base * (1 + Math.min(1.6, (am - 1) * 0.35)) * veilBreath;
	});

	const veilTexture = makeRadialTexture([
		[0.00, 'rgba(255, 255, 255, 0.55)'],
		[0.40, 'rgba(255, 255, 255, 0.18)'],
		[0.80, 'rgba(255, 255, 255, 0.04)'],
		[1.00, 'rgba(0, 0, 0, 0)'],
	]);

	$effect(() => () => veilTexture.dispose());
</script>

<!-- renderOrder=-1 → painted before SunGlow's halo (0) and core (1). -->
<T.Sprite
	position={veilPos}
	scale={[VEIL_SIZE_M, VEIL_SIZE_M, 1]}
	renderOrder={-1}
>
	<T.SpriteMaterial
		map={veilTexture}
		color={veilColor}
		opacity={veilOpacity}
		transparent
		depthWrite={false}
		depthTest={false}
		blending={AdditiveBlending}
	/>
</T.Sprite>
