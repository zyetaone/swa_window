<script lang="ts">
	/**
	 * CityGlowDome — the warm skyglow a real city throws up into the haze at
	 * night, the low-frequency "there's a vast city down there" signal that VIIRS
	 * + neon lines (high-frequency detail) don't supply. An additive amber radial
	 * sprite anchored over the city centroid, lifted a few km, gated by
	 * nightFactor. One sprite, negligible Pi cost — bloom amplifies it for free.
	 *
	 * Anchored at (lat, lon) via the shared enuAnchorMatrix (same pattern as
	 * OsmRoads / OsmBuildingEdges), so it tracks the active location and tiles
	 * across the 3-Pi panorama deterministically (no RNG → invariant #4 safe).
	 */
	import { T, useTask } from '@threlte/core';
	import { AdditiveBlending, Color, type Group as ThreeGroup, type Matrix4 } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { enuAnchorMatrix } from './enu';
	import { makeRadialTexture } from './texture-util';
	import { lightingState } from './lighting';

	const model = useAeroWindow();

	const DOME_HEIGHT_M = 2500; // glow centre lifted above the city
	const DOME_RADIUS_M = 16000; // ~metro radius; sprite is wider than tall (dome)

	let group = $state.raw<ThreeGroup | undefined>();

	const anchor = $derived.by<Matrix4 | null>(() => {
		const loc = model.currentLocation;
		return loc ? enuAnchorMatrix(loc.lat, loc.lon, 0) : null;
	});

	$effect(() => {
		if (!group || !anchor) return;
		group.matrixAutoUpdate = false;
		group.matrix.copy(anchor);
	});

	// Faint breathing so the dome doesn't read as a static decal.
	let _t = $state(0);
	useTask((dt) => { _t += dt; });

	const opacity = $derived.by(() => {
		// cityGlowAmount (lighting SSOT) owns the "dusk-onward city skyglow" gate
		// — 0 until nf > 0.45, smoothstep ramp after. Same gate the cloud city
		// glow now reads, so dome + clouds light up in lock-step.
		const cityGlow = lightingState(model.timeOfDay, model.nightFactor).cityGlowAmount;
		const breath = 1 + 0.07 * Math.sin(_t * 0.05);
		// 0.2 → 0.28: with the grade's night contrast softened the dome is
		// the layer that fuses VIIRS + neon + windows into ONE city — a bit
		// more ambient skyglow presence sells the unified haze.
		return cityGlow * 0.28 * breath;
	});

	// Sodium-amber, matched to the Cesium grade's warm city-light palette so the
	// dome reinforces it rather than fighting it.
	const amber = new Color(1.0, 0.55, 0.2);
	const tex = makeRadialTexture([
		[0.0, 'rgba(255, 255, 255, 0.6)'],
		[0.35, 'rgba(255, 255, 255, 0.22)'],
		[0.7, 'rgba(255, 255, 255, 0.05)'],
		[1.0, 'rgba(0, 0, 0, 0)'],
	]);
	$effect(() => () => tex.dispose());
</script>

{#if anchor}
	<T.Group bind:ref={group}>
		<!-- Wider than tall → a dome cap, not a ball. depthTest true so the wing
		     and near geometry occlude it; depthWrite false (additive). -->
		<T.Sprite
			position={[0, DOME_HEIGHT_M, 0]}
			scale={[DOME_RADIUS_M * 2.2, DOME_RADIUS_M * 1.1, 1]}
			renderOrder={-1}
		>
			<T.SpriteMaterial
				map={tex}
				color={amber}
				{opacity}
				transparent
				depthWrite={false}
				blending={AdditiveBlending}
			/>
		</T.Sprite>
	</T.Group>
{/if}
