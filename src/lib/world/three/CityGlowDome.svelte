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
	import { AdditiveBlending, Color, type Group as ThreeGroup, type Matrix4, type SpriteMaterial } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { enuAnchorMatrix, applyEnuAnchor } from './enu';
	import { groundAltM } from '$content/locations';
	import { CITY_GLOW } from '$content/palettes';
	import { makeRadialTexture } from './texture-util';
	import { lightingState } from '$lib/world/curves';
	import { getViirsField } from '$lib/world/viirs-field';

	const model = useAeroWindow();

	const DOME_HEIGHT_M = 900; // glow centre kept LOW — hugs the horizon, not a sky wash
	const DOME_RADIUS_M = 14000; // ~metro radius; sprite is wider than tall (dome)

	let group = $state.raw<ThreeGroup | undefined>();

	const anchor = $derived.by<Matrix4 | null>(() => {
		const loc = model.currentLocation;
		return loc ? enuAnchorMatrix(loc.lat, loc.lon, groundAltM(loc.id)) : null;
	});

	$effect(() => {
		if (group && anchor) applyEnuAnchor(group, anchor);
	});

	// Opacity is driven IMPERATIVELY in useTask, not via a $derived. A $derived
	// reading a per-frame `_t` counter would invalidate the Svelte reactive graph
	// every frame for a value only the SpriteMaterial consumes — pure scheduling
	// overhead. Holding the material ref + setting `.opacity` directly bypasses it.
	let _t = 0;
	let spriteMat = $state.raw<SpriteMaterial | undefined>();
	useTask((dt) => {
		_t += dt;
		const m = spriteMat;
		if (!m) return;
		// cityGlowAmount (lighting SSOT) owns the dusk-onward skyglow gate — the
		// diffuse companion to cityLightAmount (the dome lags the discrete lights).
		// 0.11 cap (was 0.28): at 0.28 this wide additive sprite WASHED the upper
		// sky/horizon warm-brown from cruise. Faint glow + low DOME_HEIGHT keeps it
		// a "vast city below" haze hugging the horizon, not a sky tint; bloom lifts
		// it. Faint breathing so it doesn't read as a static decal.
		const cityGlow = lightingState(model.timeOfDay, model.nightFactor).cityGlowAmount;
		m.opacity = cityGlow * 0.11 * viirsGate() * (1 + 0.07 * Math.sin(_t * 0.05));
	});

	/**
	 * Skyglow needs a city under it. cityGlowAmount answers "is it night" and
	 * nothing here answered "is there anything down there" — so the dome hazed
	 * the horizon amber over open ocean and empty desert exactly as hard as
	 * over Hyderabad, while the bokeh carpet (which culls below a VIIRS floor
	 * of 0.12) correctly rendered nothing. Same VIIRS field, same units, so the
	 * two layers now agree about the same ground.
	 *
	 * Throttled to ~4 Hz and eased: the field is a coarse ~1.2 km/px raster and
	 * an un-eased read makes the whole horizon glow step as the camera crosses
	 * a pixel. Holds the previous value while a tile loads, so nothing flickers
	 * during streaming.
	 */
	let gate = 1;
	let gateAt = 0;
	function viirsGate(): number {
		const now = performance.now();
		if (now - gateAt < 250) return gate;
		gateAt = now;
		const f = getViirsField(model.flight.camLat, model.flight.camLon);
		if (!f) return gate;
		const b = f.sampleBilinear(model.flight.camLat, model.flight.camLon);
		// Same 0.12 floor as CityLightField, ramped to full by 0.45 — below the
		// floor there is no city, so there is no skyglow.
		const target = Math.max(0, Math.min(1, (b - 0.12) / (0.45 - 0.12)));
		gate += (target - gate) * 0.25;
		return gate;
	}

	// Diffuse skyglow tint — from the shared city-lights palette (CITY_GLOW) so
	// the dome stays in the same warm family as the carpet + streets + Cesium grade.
	const amber = new Color(...CITY_GLOW);
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
			scale={[DOME_RADIUS_M * 2.2, DOME_RADIUS_M * 0.7, 1]}
			renderOrder={-1}
		>
			<T.SpriteMaterial
				bind:ref={spriteMat}
				map={tex}
				color={amber}
				opacity={0}
				transparent
				depthWrite={false}
				blending={AdditiveBlending}
			/>
		</T.Sprite>
	</T.Group>
{/if}
