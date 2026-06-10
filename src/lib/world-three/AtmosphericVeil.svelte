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
	import { computeSunDirection } from './sky';
	import { lightingState } from './lighting';
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

	// Colour from the unified lighting SSOT's CONTINUOUS sky palette — no hard
	// phase switch, so the veil no longer seams at the old 7.5 / 17 boundaries
	// (a contributor to the banded-horizon look).
	const _veilColorScratch = new Color();
	const veilColor = $derived.by(() => {
		const s = lightingState(model.timeOfDay, model.nightFactor);
		return _veilColorScratch.setRGB(s.skyTint[0], s.skyTint[1], s.skyTint[2]);
	});

	// Slow breathing — solar prominence / atmospheric wave throb. 0.018 +
	// 0.031 + 0.013 Hz frequencies give ~10s quasi-random envelope, ±8%.
	let _veilT = $state(0);
	useTask((dt) => { _veilT += dt; });
	const veilBreath = $derived.by(() => {
		const t = _veilT;
		const n = 0.5 * Math.sin(t * 0.018) + 0.3 * Math.cos(t * 0.031) + 0.2 * Math.sin(t * 0.013);
		return 1 + n * 0.08;
	});

	const veilOpacity = $derived.by(() => {
		const s = lightingState(model.timeOfDay, model.nightFactor);
		// Subtle day haze floor (0.04 — was 0.10, which washed the whole sky)
		// + a warm dawn/dusk hero bump driven by the SINGLE eased+capped
		// dawnDuskWeight (so dusk can no longer blow out), fading to a faint
		// night-blue wash. One continuous formula — no per-phase branches.
		const warm = 0.04 + 0.18 * s.dawnDuskWeight;
		const night = 0.06 * s.nightDarkness;
		return Math.max(warm, night) * veilBreath;
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
