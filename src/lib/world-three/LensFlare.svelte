<script lang="ts">
	/**
	 * LensFlare — Three.js Lensflare addon at the sun's world position.
	 *
	 * Drives the golden-hour cinema look: when the sun is in or near the
	 * camera frustum, screen-space ghost flares paint along the line from
	 * the sun to the screen centre. The Lensflare addon handles all the
	 * screen-space projection internally — we just place the parent
	 * PointLight at the sun's direction × placement radius.
	 *
	 * Texture is a procedural radial gradient (same pattern SunGlow uses
	 * but smaller + warmer-biased).
	 *
	 * Imperative (uses ctx.scene.add) because Lensflare is a non-T-proxied
	 * Three.js Object3D that lives outside Threlte's declarative tree.
	 */
	import { useThrelte, useTask } from '@threlte/core';
	import { PointLight, Color } from 'three';
	import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { computeSunDirection, SUN_PLACEMENT_M } from './sky';
	import { makeRadialTexture } from './texture-util';

	const model = useAeroWindow();
	const ctx = useThrelte();

	// SUN_PLACEMENT_M imported from sky.ts (shared with SunGlow + EffectStack +
	// Moon) so flare ghosts originate at the exact same world point as the
	// visible sun sprite and GodRays light source.

	const ghost = makeRadialTexture([
		[0,   'rgba(255, 255, 255, 1.0)'],
		[0.3, 'rgba(255, 220, 160, 0.6)'],
		[0.7, 'rgba(255, 160, 80, 0.18)'],
		[1.0, 'rgba(0, 0, 0, 0)'],
	], 128);

	// The light is a vessel for Lensflare — its actual lighting contribution
	// is irrelevant (we set intensity=0). What matters is its world position,
	// which Lensflare uses for screen-space projection.
	const light = new PointLight(0xffffff, 0);

	const flare = new Lensflare();
	// Restraint: 5 saturated-orange ghosts in a line read as the classic
	// "Doctor Strange lens flare" stamp — instantly illustrated. Restraint:
	// keep only the anchor glow + ONE faint distant ghost. Colors pulled
	// toward neutral white (real camera optical coating reads cooler) and
	// sizes shrunk. Result: a subtle radial brighten at the sun position
	// + one barely-visible ghost on the opposite side, no Hollywood streak.
	const anchorGhost = new LensflareElement(ghost, 220, 0, new Color(1.0, 0.92, 0.78));
	const g1 = new LensflareElement(ghost, 38, 0.85, new Color(0.95, 0.92, 0.88));
	flare.addElement(anchorGhost);
	flare.addElement(g1);
	light.add(flare);

	ctx.scene.add(light);

	$effect(() => {
		const dir = computeSunDirection(model.flight.camLon, model.timeOfDay);
		light.position.set(
			dir[0] * SUN_PLACEMENT_M,
			dir[1] * SUN_PLACEMENT_M,
			dir[2] * SUN_PLACEMENT_M,
		);

		// Visibility — only at low sun angles (golden-hour wash). Lowered
		// max from 0.78 → 0.42 + raised threshold so flare is essentially
		// invisible above 30° elevation (matches real airline-window glass
		// with anti-reflective coating, which doesn't flare except at very
		// shallow angles).
		const elev = Math.max(0.06, dir[1]);
		const airMass = 1.0 / elev;
		let vis = Math.pow(airMass * 0.42, 1.85) * (1 - model.nightFactor * 0.93);
		// Final wash dialed 0.42 → 0.28 and anchor glow shrunk 220 → 150 so
		// the flare reads as a faint optical hint, not a hovering bright disc.
		vis = Math.min(vis, 0.95) * 0.28;

		const ghostScale = Math.max(0.10, Math.min(0.90, airMass * 0.24));
		_anchorBaseSize = 150 * ghostScale;
		_g1BaseSize = 30 * ghostScale;

		light.visible = vis > 0.12;
	});

	// Per-frame jitter — real cameras don't hold lens-flare ghosts
	// perfectly steady; micro-vibration from the airframe + atmospheric
	// turbulence wobbles the optical reflections. Sizes are stored as
	// _bases (set in $effect from current air-mass) and re-multiplied
	// each frame so the wobble doesn't compound.
	let _anchorBaseSize = 220;
	let _g1BaseSize = 38;
	let _flareT = 0;
	useTask((dt) => {
		if (!light.visible) return;
		_flareT += dt;
		const w1 = 1 + 0.06 * Math.sin(_flareT * 4.13) * Math.cos(_flareT * 7.91);
		const w2 = 1 + 0.10 * Math.sin(_flareT * 6.71) * Math.cos(_flareT * 13.07);
		anchorGhost.size = _anchorBaseSize * w1;
		g1.size = _g1BaseSize * w2;
	});

	$effect(() => () => {
		ctx.scene.remove(light);
		light.remove(flare);
		// Lensflare.dispose exists on the addon's class.
		(flare as unknown as { dispose: () => void }).dispose?.();
		ghost.dispose();
	});
</script>
