<script lang="ts">
	/**
	 * WeatherEffects - Atmospheric weather phenomena
	 *
	 * Effects:
	 * - Rain streaks on window (during descent through rain)
	 * - Snow particles
	 * - Lightning flashes (distant storms)
	 * - Contrails from other aircraft
	 */

	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { getViewerState } from '$lib/core/state.svelte';
	import { PERFORMANCE, ATMOSPHERE, UNITS } from '$lib/core/constants';

	const viewer = getViewerState();

	// Limits from constants
	const MAX_OWN_CONTRAIL_PARTICLES = PERFORMANCE.MAX_CONTRAIL_PARTICLES;
	const MAX_DISTANT_CONTRAILS = 20; // Distant aircraft limit
	const CONTRAIL_LIFETIME = PERFORMANCE.CONTRAIL_LIFETIME;

	// Rain streak shader (on window glass)
	const rainStreakMaterial = new THREE.ShaderMaterial({
		uniforms: {
			uTime: { value: 0 },
			uIntensity: { value: 0.5 },
			uSpeed: { value: 1.0 }
		},
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform float uIntensity;
			uniform float uSpeed;
			varying vec2 vUv;

			float hash(vec2 p) {
				return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
			}

			void main() {
				// Create vertical rain streaks
				float streakX = floor(vUv.x * 50.0);
				float streakRand = hash(vec2(streakX, 0.0));

				// Animate streak position
				float streakY = fract(vUv.y - uTime * uSpeed * (0.5 + streakRand * 0.5));

				// Streak shape (long and thin)
				float streak = smoothstep(0.0, 0.3, streakY) * smoothstep(1.0, 0.7, streakY);

				// Width variation
				float width = 0.01 + streakRand * 0.02;
				float xDist = abs(fract(vUv.x * 50.0) - 0.5);
				streak *= smoothstep(width, 0.0, xDist);

				// Random visibility per streak
				streak *= step(0.7 - uIntensity * 0.3, streakRand);

				// Water refraction color (slight blue tint)
				vec3 color = vec3(0.7, 0.8, 1.0);

				gl_FragColor = vec4(color, streak * uIntensity * 0.3);
			}
		`,
		transparent: true,
		depthWrite: false
	});

	// Lightning flash state - frame-based timing instead of setTimeout
	let lightningActive = $state(false);
	let lightningIntensity = $state(0);
	let lightningTimer = 0;
	let lightningFlashAge = 0; // Time since flash started
	let lightningBaseIntensity = 0; // Initial flash intensity
	let nextLightning = Math.random() * 30 + 10;

	// Distant aircraft contrails
	interface Contrail {
		id: number;
		position: THREE.Vector3;
		direction: THREE.Vector3;
		length: number;
		age: number;
	}

	let contrails = $state<Contrail[]>([]);
	let contrailId = 0;

	// Weather condition determines effects
	// Rain only visible below cloud base or during descent through clouds
	// Storm clouds extend higher, overcast cloud base is lower
	const cloudBaseAltitude = $derived(
		viewer.weather === 'storm' ? 20000 : // Storm clouds higher
		viewer.weather === 'overcast' ? 12000 : // Overcast cloud base
		8000 // Default cloud base
	);
	const showRain = $derived(
		(viewer.weather === 'storm' || viewer.weather === 'overcast') &&
		viewer.altitude < cloudBaseAltitude
	);

	const showLightning = $derived(viewer.weather === 'storm');

	const showContrails = $derived(viewer.altitude > 25000 && viewer.showClouds);

	// Contrail geometry
	const contrailGeometry = new THREE.CylinderGeometry(5, 5, 1, 8);
	contrailGeometry.rotateZ(Math.PI / 2);

	const contrailMaterial = new THREE.MeshBasicMaterial({
		color: 0xffffff,
		transparent: true,
		opacity: 0.6
	});

	// Own aircraft contrails - visible from side window
	// Engine positions (relative to camera/viewer position)
	// For a side window view, engines are under the wing, slightly behind
	const ENGINE_OFFSET = { x: -4, y: -2, z: 3 }; // Left engine position relative to window

	// Contrail particles for own aircraft
	interface OwnContrailParticle {
		id: number;
		position: THREE.Vector3;
		age: number;
		size: number;
	}

	let ownContrailParticles = $state<OwnContrailParticle[]>([]);
	let ownContrailId = 0;

	// Reusable temp vector to avoid allocations in animation loop
	const tempVector = new THREE.Vector3();

	// Own contrails only visible at cruise altitude
	const showOwnContrails = $derived(viewer.altitude > 28000);

	// Contrail emission rate based on altitude (more visible at higher alt)
	const contrailEmissionRate = $derived(
		showOwnContrails ? Math.min(1, (viewer.altitude - 28000) / 10000) : 0
	);

	// Clear contrails when visibility conditions change
	$effect(() => {
		if (!showOwnContrails) {
			ownContrailParticles = [];
		}
	});

	$effect(() => {
		if (!showContrails) {
			contrails = [];
		}
	});

	// Add to the existing useTask
	const updateOwnContrails = (delta: number) => {
		// Only emit if under limit and conditions met
		if (
			showOwnContrails &&
			ownContrailParticles.length < MAX_OWN_CONTRAIL_PARTICLES &&
			Math.random() < contrailEmissionRate * 0.5
		) {
			// Emit new particle from engine position
			const spread = 0.5;
			ownContrailParticles = [
				...ownContrailParticles,
				{
					id: ownContrailId++,
					position: new THREE.Vector3(
						ENGINE_OFFSET.x + (Math.random() - 0.5) * spread,
						ENGINE_OFFSET.y + (Math.random() - 0.5) * spread,
						ENGINE_OFFSET.z + (Math.random() - 0.5) * spread
					),
					age: 0,
					size: 0.3 + Math.random() * 0.2
				}
			];
		}

		// Update particles - they drift backwards (negative Z in world space)
		// Filter by age (using constant) and distance
		ownContrailParticles = ownContrailParticles
			.map((p) => ({
				...p,
				position: p.position.clone().add(tempVector.set(0, delta * 0.5, -delta * 50)),
				age: p.age + delta,
				size: p.size + delta * 2 // Expand over time
			}))
			.filter((p) => p.age < CONTRAIL_LIFETIME && p.position.z > -150);
	};

	// Cleanup effect for material/geometry disposal
	$effect(() => {
		return () => {
			rainStreakMaterial.dispose();
			contrailMaterial.dispose();
			contrailGeometry.dispose();
		};
	});

	// Integrate into main animation loop
	useTask((delta) => {
		// Update rain
		rainStreakMaterial.uniforms.uTime.value += delta;
		rainStreakMaterial.uniforms.uIntensity.value = showRain
			? viewer.weather === 'storm'
				? 0.8
				: 0.4
			: 0;

		// Lightning timing - frame-based
		if (showLightning) {
			lightningTimer += delta;

			// Update active lightning flash
			if (lightningActive) {
				lightningFlashAge += delta;

				// Phase 1: Full intensity (0-100ms)
				// Phase 2: Fading (100-150ms)
				// Phase 3: Done (>150ms)
				if (lightningFlashAge < 0.1) {
					lightningIntensity = lightningBaseIntensity;
				} else if (lightningFlashAge < 0.15) {
					lightningIntensity = lightningBaseIntensity * 0.3;
				} else {
					lightningActive = false;
					lightningIntensity = 0;
				}
			}

			// Trigger new lightning
			if (!lightningActive && lightningTimer > nextLightning) {
				lightningActive = true;
				lightningBaseIntensity = 0.5 + Math.random() * 0.5;
				lightningIntensity = lightningBaseIntensity;
				lightningFlashAge = 0;
				lightningTimer = 0;
				nextLightning = Math.random() * 20 + 5;
			}
		}

		// Contrail management - only spawn if under limit
		if (showContrails && contrails.length < MAX_DISTANT_CONTRAILS && Math.random() < 0.001) {
			// Spawn new contrail
			const angle = Math.random() * Math.PI * 2;
			const distance = 20000 + Math.random() * 30000;
			const alt = (ATMOSPHERE.CONTRAIL_MIN_ALTITUDE + Math.random() * 12000) * UNITS.FEET_TO_METERS;

			contrails = [
				...contrails,
				{
					id: contrailId++,
					position: new THREE.Vector3(
						Math.cos(angle) * distance,
						alt - viewer.altitude * UNITS.FEET_TO_METERS,
						Math.sin(angle) * distance
					),
					direction: new THREE.Vector3(
						Math.random() - 0.5,
						0,
						Math.random() - 0.5
					).normalize(),
					length: 0,
					age: 0
				}
			];
		}

		// Update contrails - age and grow, filter old ones
		contrails = contrails
			.map((c) => ({
				...c,
				length: Math.min(c.length + delta * 500, 3000),
				age: c.age + delta
			}))
			.filter((c) => c.age < 60);

		// Update own aircraft contrails
		updateOwnContrails(delta);
	});
</script>

<!-- Rain streaks overlay (fullscreen quad would be handled by post-processing) -->
{#if showRain}
	<T.Mesh position={[0, 0, -1]} renderOrder={100}>
		<T.PlaneGeometry args={[2, 2]} />
		<T is={rainStreakMaterial} />
	</T.Mesh>
{/if}

<!-- Lightning ambient flash (subtle) -->
{#if lightningActive}
	<T.AmbientLight color={0xaaaaff} intensity={lightningIntensity * 0.5} />
	<T.DirectionalLight
		position={[10000, 5000, -20000]}
		color={0xffffff}
		intensity={lightningIntensity * 1.2}
	/>
{/if}

<!-- Distant contrails -->
{#each contrails as contrail (contrail.id)}
	<T.Group
		position={[contrail.position.x, contrail.position.y, contrail.position.z]}
		rotation.y={Math.atan2(contrail.direction.x, contrail.direction.z)}
	>
		<T.Mesh
			geometry={contrailGeometry}
			material={contrailMaterial}
			scale.x={contrail.length}
			position.x={contrail.length / 2}
		>
			<T.MeshBasicMaterial
				color={0xffffff}
				transparent
				opacity={Math.max(0, 0.3 - contrail.age * 0.005)}
			/>
		</T.Mesh>

		<!-- Aircraft dot at head of contrail -->
		<T.Mesh position.x={contrail.length}>
			<T.SphereGeometry args={[20, 8, 8]} />
			<T.MeshBasicMaterial color={0xcccccc} />
		</T.Mesh>
	</T.Group>
{/each}

<!-- Own aircraft contrails (visible from side window at high altitude) -->
{#each ownContrailParticles as particle (particle.id)}
	<T.Mesh
		position={[particle.position.x, particle.position.y, particle.position.z]}
		scale={[particle.size, particle.size, particle.size]}
	>
		<T.SphereGeometry args={[1, 8, 8]} />
		<T.MeshBasicMaterial
			color={0xffffff}
			transparent
			opacity={Math.max(0, 0.35 - particle.age * 0.12)}
		/>
	</T.Mesh>
{/each}
