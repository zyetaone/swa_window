<script lang="ts">
	/**
	 * Venus — the morning star. A single bright sprite that appears 30-60
	 * minutes before sunrise (timeOfDay ~5.0 → 6.8 local solar time),
	 * positioned slightly above the eastern horizon, ahead of the sun.
	 *
	 * Why this lands: Venus is the brightest natural object in the sky
	 * after the Sun and Moon — magnitude -4 to -4.5, visible to the naked
	 * eye even in twilight. Real window-seat passengers who fly early-
	 * morning routes WILL notice it. Nothing else in the current stack
	 * fills that pre-dawn slot.
	 *
	 * Implementation: piggybacks on the existing radial-sprite + sun-dir
	 * infrastructure. Venus position = sun direction rotated slightly to
	 * one side (Venus is always within ~47° of the sun — usually 10-30°
	 * leading at dawn). We pick a fixed 20° offset for visual clarity.
	 * Opacity ramps via a smoothstep on timeOfDay, peaking around 5.8
	 * (when the sky is still dim but Venus is unmistakable).
	 *
	 * Geometry note: at SUN_PLACEMENT_M Venus reads as a fixed star, which
	 * is perceptually correct — it's far enough that camera parallax over
	 * a passenger window is undetectable.
	 */
	import { T, useTask, useThrelte } from '@threlte/core';
	import { AdditiveBlending, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, SUN_PLACEMENT_M } from '$lib/world/sky';
	import { earthOcclusionFactor } from './occlusion';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// Earth-occlusion (shared with Moon.svelte via ./occlusion): fade Venus out
	// when the planet is between the camera and the sprite. Venus is biased just
	// above the SUN-space horizon, but that isn't the camera's LOCAL horizon — so
	// without this it can bleed straight through the Earth the way the moon did.
	// depthTest:false means this opacity factor is the only thing that can hide
	// it behind the limb.
	let occlusionFactor = $state(1);

	// Venus is real-world ~1.7° subtended at brightest. We use a tiny
	// sprite + bloom halo for the actual visual punch — the core itself
	// reads as a hot point, bloom expands it into a recognisable star.
	const VENUS_SIZE_M = 1.9e6;

	// Dawn window: Venus is visible from astronomical twilight (~ sun at
	// -18°) through civil twilight (sun at -6°) and even ~30 min after
	// sunrise on its best mornings. timeOfDay 5.0..6.8 covers the
	// "passenger looking out the window before coffee" beat. We don't
	// bother modelling Venus's real ephemeris — the goal is a moment, not
	// an astronomy app. tod 6.0 is the visibility peak.
	const visibility = $derived.by(() => {
		const t = model.timeOfDay;
		if (t < 4.8 || t > 7.0) return 0;
		// Two-sided smoothstep: rises 4.8→5.8, falls 6.2→7.0.
		const rise = Math.max(0, Math.min(1, (t - 4.8) / 1.0));
		const fall = Math.max(0, Math.min(1, (7.0 - t) / 0.8));
		return rise * fall;
	});

	// Position: sun direction with a slight angular offset. Venus is the
	// MORNING star (visible BEFORE sunrise to the east-of-sun side). We
	// derive position by rotating the sun direction in the XZ plane by
	// ~20° clockwise (sun on Y+ axis convention) so Venus leads the sun.
	const VENUS_OFFSET_RAD = 20 * Math.PI / 180;
	const cosOff = Math.cos(VENUS_OFFSET_RAD);
	const sinOff = Math.sin(VENUS_OFFSET_RAD);
	const venusPos = $derived.by<[number, number, number]>(() => {
		const d = computeSunDirection(model.flight.camLon, model.timeOfDay);
		// Rotate XZ around Y axis. Slight upward bias so Venus reads
		// "above the horizon at first light," not co-aligned with the sun.
		const x = d[0] * cosOff - d[2] * sinOff;
		const y = Math.max(d[1] + 0.04, 0.04);
		const z = d[0] * sinOff + d[2] * cosOff;
		return [x * SUN_PLACEMENT_M, y * SUN_PLACEMENT_M, z * SUN_PLACEMENT_M];
	});

	// Slight twinkle for a planet-vs-star distinction: real planets DON'T
	// twinkle much (they subtend a measurable angle so atmospheric
	// scintillation averages out). But a tiny pulse keeps the sprite from
	// looking pasted on. ~4% amplitude at ~0.7 Hz.
	//
	// useTask early-exits when Venus isn't visible (~22 of 24 hours): the
	// dawn window is t∈[4.8, 7.0] local — outside that the timer doesn't
	// need to tick + the derived doesn't need to recompute. Saves a per-
	// frame state write + $derived re-run for the dominant time fraction.
	let _vT = $state(0);
	useTask((dt) => {
		if (visibility <= 0) return;
		_vT += dt;
		// Ray from camera toward Venus vs the Earth sphere (see ./occlusion).
		const cam = ctx.camera.current.position;
		const vx = venusPos[0] - cam.x, vy = venusPos[1] - cam.y, vz = venusPos[2] - cam.z;
		const vlen = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
		const factor = earthOcclusionFactor(
			cam.x, cam.y, cam.z,
			vx / vlen, vy / vlen, vz / vlen,
		);
		if (factor !== occlusionFactor) occlusionFactor = factor;
	});
	const twinkleFactor = $derived(visibility > 0 ? 1 + 0.04 * Math.sin(_vT * 4.4) : 1);

	const venusColor = new Color(1.0, 0.97, 0.92);
	const venusTex = makeRadialTexture([
		[0.00, 'rgba(255, 252, 240, 1.0)'],
		[0.18, 'rgba(255, 245, 220, 0.85)'],
		[0.50, 'rgba(255, 230, 195, 0.25)'],
		[1.00, 'rgba(255, 210, 170, 0)'],
	]);

	$effect(() => () => venusTex.dispose());
</script>

<T.Sprite
	position={venusPos}
	scale={[VENUS_SIZE_M, VENUS_SIZE_M, 1]}
	renderOrder={2}
>
	<!-- depthTest ON: built-in SpriteMaterial handles the log depth buffer, so
	     the wing's depth writes occlude Venus (clouds are depthWrite:false and
	     never occlude). The Earth is in CESIUM's depth buffer, not Three's —
	     occlusionFactor above remains the only Earth occluder. -->
	<T.SpriteMaterial
		map={venusTex}
		color={venusColor}
		opacity={visibility * twinkleFactor * occlusionFactor}
		transparent
		depthWrite={false}
		depthTest={true}
		blending={AdditiveBlending}
	/>
</T.Sprite>
