<script lang="ts">
	/**
	 * EnhancedWing - Airplane wing with navigation lights
	 *
	 * Reads all state from model - no local animation state
	 */
	import { T } from "@threlte/core";
	import { useGltf, Suspense } from "@threlte/extras";

	// Load GLTF model
	const gltf = useGltf("/models/boeing_737/scene.gltf");

	// Position/rotation
	const position: [number, number, number] = [-3.5, -1.5, 2];
	const rotation: [number, number, number] = [0.05, -Math.PI / 2.1, 0.02];
</script>

<Suspense>
	{#if $gltf}
		<T.Group {position} {rotation} scale={0.05}>
			<!-- Wing model -->
			<T is={$gltf.scene} />

			<!-- Nav lights and strobe disabled - wing not visible from current camera angle -->
		</T.Group>
	{/if}
</Suspense>
