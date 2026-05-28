<script lang="ts">
	/**
	 * ThreeOverlay — transparent Three.js canvas mounted ABOVE Cesium.
	 *
	 * The Cesium+Three composition split:
	 *   Cesium  → terrain, imagery (EOX Sentinel-2 + VIIRS night lights),
	 *             atmosphere, color-grade shader, bloom — everything its
	 *             tile-streaming + post-process pipeline already does well.
	 *   Three   → clouds (the cluster sprite system) + future custom shader
	 *             effects that Cesium's fixed pipeline can't accommodate.
	 *
	 * Camera sync via <CameraMirror> — copies Cesium's positionWC /
	 * directionWC / upWC / fovy into our PerspectiveCamera every frame
	 * (Cesium-pull model, not push). The canvas itself is transparent
	 * (`alpha: true` + `background: transparent`) so Cesium shows through
	 * everywhere Three.js doesn't draw.
	 *
	 * Logarithmic depth + far 1e9 keep WGS84 scale precision; near 100 is
	 * fine because clouds sit at CLOUD_DECK ± 1.5 km from the camera path.
	 */
	import { Canvas, T } from '@threlte/core';
	import { PerspectiveCamera, WebGLRenderer, Color } from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import Clouds from './Clouds.svelte';
	import CameraMirror from './CameraMirror.svelte';
	import SunGlow from './SunGlow.svelte';
	import LensFlare from './LensFlare.svelte';
	import AtmosphericVeil from './AtmosphericVeil.svelte';
	import NightStars from './NightStars.svelte';
	import Moon from './Moon.svelte';
	import OsmBuildingEdges from './OsmBuildingEdges.svelte';
	import OsmRoads from './OsmRoads.svelte';
	import { computeSunDirection, environmentAmbient } from './sky';

	const model = useAeroWindow();

	// $state.raw — Three.js camera mutated each frame, must not be proxied.
	let camera: PerspectiveCamera | undefined = $state.raw();

	// Smarter environment ambient that respects air mass + nightFactor
	// while still keeping the artistic dawn/dusk mood windows.
	// This makes the base Three environment feel more consistent with
	// the upgraded artistic sky layers (Veil, SunGlow, etc.).
	const env = $derived(environmentAmbient(
		model.flight.camLon,
		model.timeOfDay,
		model.nightFactor
	));
	const ambientTint = $derived(new Color(env.color[0], env.color[1], env.color[2]));
	const ambientIntensity = $derived(env.intensity);
</script>

<div class="three-overlay" aria-hidden="true">
	<Canvas
		createRenderer={(canvas) =>
			new WebGLRenderer({
				canvas,
				antialias: true,
				alpha: true,
				powerPreference: 'high-performance',
				logarithmicDepthBuffer: true,
			})}
	>
		<T.PerspectiveCamera
			bind:ref={camera}
			makeDefault
			fov={model.config.camera.parallax.fovDeg}
			near={100}
			far={1e9}
		/>

		<!-- Sun-direction-tinted ambient — drives the whole Three-side
		     environment mood. Warm peach at dawn, neutral white at noon,
		     red-orange at dusk, cool blue at night. Cloud sprites pick
		     this up via MeshBasicMaterial-equivalent lighting (SpriteMaterial
		     ignores light but the color tint we apply during cluster
		     build already encodes nightFactor; ambient affects the future
		     non-Sprite Three-side assets we'll add). -->
		<T.AmbientLight color={ambientTint} intensity={ambientIntensity} />

		<CameraMirror {camera} />
		<!-- Order matters for additive blending depth:
		     veil (broad diffuse, renderOrder=-1) →
		     sun glow halo+core (sharp, renderOrder=0/1) →
		     lens flare (screen-space ghosts) →
		     stars (deep night, depthTest false) →
		     clouds (cluster sprites, world-anchored). -->
		<AtmosphericVeil />
		<SunGlow />
		<Moon />
		<LensFlare />
		<NightStars />
		<OsmRoads location={model.location} />
		<OsmBuildingEdges location={model.location} />
		<Clouds
			density={model.effectiveCloudDensity}
			nightFactor={model.nightFactor}
			ambientColor={ambientTint}
			ambientIntensity={ambientIntensity}
			sunDirection={computeSunDirection(model.flight.camLon, model.timeOfDay)}
		/>
	</Canvas>
</div>

<style>
	.three-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		/* Above Cesium's canvas (which sits at z:0 inside .cesium-container)
		   but below the shell's HUD layers (z:10+). Matches scene/layers.ts
		   Z.CLOUDS where prod CSS3D clouds live. */
		z-index: 5;
	}
	.three-overlay :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
		background: transparent !important;
	}
</style>
