<script lang="ts">
	/**
	 * Scene — the Threlte scene graph for a single cell.
	 *
	 * Camera is bird's-eye at altitudeMeters (default 9000 ≈ 30k ft).
	 * The camera sits at world origin (lat/lon) looking forward and
	 * slightly down, matching the "airplane side window" vantage.
	 * Heading rotates the camera around the world-up axis so cells
	 * react to the heading slider.
	 *
	 * Layer gating: `layers.has(id)` toggles which layer meshes are
	 * included in THIS cell. Cell 1 = sky only, cell 6 = everything.
	 */
	import { T } from '@threlte/core';
	import type { GridLayerId } from './lib/scene-state.svelte';
	import { sceneState } from './lib/scene-state.svelte';
	import Sky from './layers/Sky.svelte';

	let { layers }: { layers: Set<GridLayerId> } = $props();

	const DEG2RAD = Math.PI / 180;

	// Camera rotation: pitch down, then rotate around world-up by heading.
	// Three.js Euler order 'YXZ' = first yaw around Y, then pitch around
	// rotated X. Heading is clockwise-from-north, so we negate.
	const cameraRot = $derived([
		-sceneState.pitchDeg * DEG2RAD,
		-sceneState.headingDeg * DEG2RAD,
		0,
	] as [number, number, number]);
</script>

<T.PerspectiveCamera
	makeDefault
	position={[0, sceneState.altitudeMeters, 0]}
	rotation={cameraRot}
	rotation.order={'YXZ'}
	fov={55}
	near={10}
	far={2e6}
/>

<!-- Lights: keep a faint ambient so future layers (terrain, buildings)
     aren't pitch-black below sun. Directional light will sync with sun
     direction when we add takram in a later commit. -->
<T.AmbientLight intensity={0.35} />
<T.DirectionalLight position={[5000, 8000, 3000]} intensity={1.1} />

{#if layers.has('sky')}
	<Sky />
{/if}

<!-- Future layers slot in below as each commit lands:
     terrain, water, buildings, clouds, post-fx. -->
