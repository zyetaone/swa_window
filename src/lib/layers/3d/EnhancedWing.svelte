<script lang="ts">
	/**
	 * EnhancedWing - Airplane wing with navigation lights
	 *
	 * Reads all state from model - no local animation state
	 */
	import { T } from "@threlte/core";
	import { useGltf, Suspense } from "@threlte/extras";
	import { useAppState } from "$lib/core";

	const { model } = useAppState();

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

			<!-- Navigation lights (visibility and intensity from model) -->
			{#if model.showNavLights}
				<!-- Port (left) - Red -->
				<T.Group position={[-200, 10, -150]}>
					<T.PointLight color={0xff0000} intensity={model.navLightIntensity} distance={100} />
					<T.Mesh>
						<T.SphereGeometry args={[3, 8, 8]} />
						<T.MeshBasicMaterial color={0xff0000} />
					</T.Mesh>
				</T.Group>

				<!-- Starboard (right) - Green -->
				<T.Group position={[200, 10, -150]}>
					<T.PointLight color={0x00ff00} intensity={model.navLightIntensity} distance={100} />
					<T.Mesh>
						<T.SphereGeometry args={[3, 8, 8]} />
						<T.MeshBasicMaterial color={0x00ff00} />
					</T.Mesh>
				</T.Group>

				<!-- Strobe (white) - state from model -->
				{#if model.strobeOn}
					<T.Group position={[-220, 12, -150]}>
						<T.PointLight color={0xffffff} intensity={model.navLightIntensity * 2} distance={200} />
						<T.Mesh>
							<T.SphereGeometry args={[2, 8, 8]} />
							<T.MeshBasicMaterial color={0xffffff} />
						</T.Mesh>
					</T.Group>
				{/if}
			{/if}
		</T.Group>
	{/if}
</Suspense>
