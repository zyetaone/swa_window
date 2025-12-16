<script lang="ts">
	/**
	 * EnhancedWing - Realistic airplane wing with:
	 *
	 * - Navigation lights (red port, green starboard, white strobe)
	 * - Subtle flex animation in turbulence
	 * - Frost/ice accumulation at altitude
	 * - Engine glow (if visible)
	 * - Realistic materials with environment reflection
	 */

	import { T, useTask } from "@threlte/core";
	import { useGltf } from "@threlte/extras";
	import * as THREE from "three";
	import { getViewerState } from "$lib/core/state.svelte";

	const viewer = getViewerState();

	// Load the GLTF Model
	const gltf = useGltf("/models/boeing_737/scene.gltf");

	// Wing position and rotation
	// Position wing in lower-left of view, extending into frame
	// X: negative = left side of view
	// Y: negative = below camera
	// Z: positive = forward (into the scene)
	const modelPosition: [number, number, number] = [-3.5, -1.5, 2];
	const modelRotation: [number, number, number] = [
		0.05,
		-Math.PI / 2.1,
		0.02,
	];

	// Animation state
	let flexAmount = $state(0);
	let strobeOn = $state(false);
	let strobeTimer = 0;
	let turbulenceOffset = $state({ x: 0, y: 0, z: 0 });
	let accumulatedTime = 0; // For deterministic turbulence

	// Turbulence simulation
	let turbulenceIntensity = $state(0);

	// Navigation light colors
	const NAV_LIGHT_RED = new THREE.Color(0xff0000);
	const NAV_LIGHT_GREEN = new THREE.Color(0x00ff00);
	const NAV_LIGHT_WHITE = new THREE.Color(0xffffff);

	// Frost shader for wing surface
	const frostMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uBaseColor: { value: new THREE.Color(0xc0c0c0) },
			uFrostAmount: { value: 0 },
			uTime: { value: 0 },
		},
		vertexShader: /* glsl */ `
			varying vec3 vNormal;
			varying vec2 vUv;
			varying vec3 vPosition;

			void main() {
				vNormal = normalMatrix * normal;
				vUv = uv;
				vPosition = position;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uBaseColor;
			uniform float uFrostAmount;
			uniform float uTime;

			varying vec3 vNormal;
			varying vec2 vUv;
			varying vec3 vPosition;

			float noise(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			void main() {
				vec3 color = uBaseColor;

				// Frost accumulation pattern
				float frost = noise(vUv * 20.0 + uTime * 0.01);
				frost = smoothstep(1.0 - uFrostAmount, 1.0, frost);

				// Frost is white/blue
				vec3 frostColor = vec3(0.9, 0.95, 1.0);
				color = mix(color, frostColor, frost * uFrostAmount);

				// Simple lighting
				vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
				float diffuse = max(dot(vNormal, lightDir), 0.0);
				color *= 0.5 + diffuse * 0.5;

				gl_FragColor = vec4(color, 1.0);
			}
		`,
	});

	// Update frost based on altitude
	$effect(() => {
		const frostAmount = Math.max(0, (viewer.altitude - 25000) / 20000);
		frostMaterial.uniforms.uFrostAmount.value = frostAmount;
	});

	// Cleanup effect for material disposal
	$effect(() => {
		return () => {
			frostMaterial.dispose();
		};
	});

	// Animation loop
	useTask((delta) => {
		// Accumulate time for deterministic animations
		accumulatedTime += delta;

		// Strobe timing (flash every 1.5 seconds)
		strobeTimer += delta;
		if (strobeTimer > 1.5) {
			strobeOn = !strobeOn;
			if (strobeOn)
				strobeTimer = 1.4; // Quick off
			else strobeTimer = 0;
		}

		// Turbulence simulation using accumulated time (deterministic)
		const t = accumulatedTime;
		const turbulence = Math.sin(t * 1.0) * 0.3 + Math.sin(t * 2.3) * 0.2;
		turbulenceIntensity = Math.abs(turbulence) * 0.5;

		// Wing flex based on turbulence
		flexAmount = turbulence * 0.02;

		// Turbulence offset for subtle shake
		turbulenceOffset = {
			x: Math.sin(t * 5.0) * turbulenceIntensity * 0.1,
			y: Math.sin(t * 7.0) * turbulenceIntensity * 0.05,
			z: Math.sin(t * 3.0) * turbulenceIntensity * 0.1,
		};

		// Update frost time
		frostMaterial.uniforms.uTime.value += delta;
	});

	// Calculate final position with turbulence
	const finalPosition = $derived<[number, number, number]>([
		modelPosition[0] + turbulenceOffset.x,
		modelPosition[1] + turbulenceOffset.y,
		modelPosition[2] + turbulenceOffset.z,
	]);

	// Calculate rotation with flex
	const finalRotation = $derived<[number, number, number]>([
		flexAmount,
		modelRotation[1],
		modelRotation[2],
	]);

	// Light visibility based on time of day
	const lightsVisible = $derived(
		viewer.skyState === "night" ||
			viewer.skyState === "dusk" ||
			viewer.skyState === "dawn",
	);

	// Light intensity
	const lightIntensity = $derived(
		viewer.skyState === "night"
			? 1.0
			: viewer.skyState === "dusk" || viewer.skyState === "dawn"
				? 0.7
				: 0.3,
	);
</script>

{#if $gltf}
	<T.Group position={finalPosition} rotation={finalRotation} scale={0.05}>
		<!-- Main wing model -->
		<T is={$gltf.scene} />

		<!-- Navigation Lights -->
		{#if lightsVisible}
			<!-- Port (left) - Red -->
			<T.Group position={[-200, 10, -150]}>
				<T.PointLight
					color={NAV_LIGHT_RED}
					intensity={lightIntensity}
					distance={100}
				/>
				<T.Mesh>
					<T.SphereGeometry args={[3, 16, 16]} />
					<T.MeshBasicMaterial color={NAV_LIGHT_RED} />
				</T.Mesh>
			</T.Group>

			<!-- Starboard (right) - Green -->
			<T.Group position={[200, 10, -150]}>
				<T.PointLight
					color={NAV_LIGHT_GREEN}
					intensity={lightIntensity}
					distance={100}
				/>
				<T.Mesh>
					<T.SphereGeometry args={[3, 16, 16]} />
					<T.MeshBasicMaterial color={NAV_LIGHT_GREEN} />
				</T.Mesh>
			</T.Group>

			<!-- White strobe (wingtip) -->
			{#if strobeOn}
				<T.Group position={[-220, 12, -150]}>
					<T.PointLight
						color={NAV_LIGHT_WHITE}
						intensity={lightIntensity * 2}
						distance={200}
					/>
					<T.Mesh>
						<T.SphereGeometry args={[2, 16, 16]} />
						<T.MeshBasicMaterial color={NAV_LIGHT_WHITE} />
					</T.Mesh>
				</T.Group>
			{/if}

			<!-- Anti-collision beacon (red, on fuselage) -->
			<T.Group position={[50, 20, 100]}>
				<T.PointLight
					color={NAV_LIGHT_RED}
					intensity={strobeOn ? lightIntensity * 3 : 0}
					distance={150}
				/>
				{#if strobeOn}
					<T.Mesh>
						<T.SphereGeometry args={[4, 16, 16]} />
						<T.MeshBasicMaterial color={NAV_LIGHT_RED} />
					</T.Mesh>
				{/if}
			</T.Group>
		{/if}

		<!-- Engine glow (subtle orange from nacelle) -->
		{#if viewer.altitude > 1000}
			<T.Group position={[-80, -20, 50]}>
				<T.PointLight
					color={new THREE.Color(0xff6600)}
					intensity={0.3}
					distance={50}
				/>
			</T.Group>
		{/if}
	</T.Group>
{/if}
