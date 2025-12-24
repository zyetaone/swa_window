<script lang="ts">
	/**
	 * VolumetricClouds - 3D positioned clouds that drift through the scene
	 *
	 * NOT screen-space overlay - actual 3D cloud planes positioned in world space
	 * that move independently as the "plane" flies forward
	 */
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { useAppState } from '$lib/core';

	const { model } = useAppState();

	// Cloud configuration - SIDE WINDOW VIEW
	// Plane flies forward, passenger looks out side window
	// Clouds appear to drift from FRONT of plane to BACK (right to left in view)
	const CLOUD_COUNT = 20;
	const CLOUD_DEPTH_MIN = -80;   // Closest clouds
	const CLOUD_DEPTH_MAX = -300;  // Farthest clouds
	const CLOUD_SPAWN_X = -120;    // Spawn on LEFT (front of plane in view)
	const CLOUD_EXIT_X = 120;      // Exit on RIGHT (back of plane in view)
	const CLOUD_MIN_Y = -25;       // Below eye level
	const CLOUD_MAX_Y = 40;        // Above eye level

	// Cloud colors by time of day
	const CLOUD_COLORS: Record<string, THREE.Color> = {
		day: new THREE.Color(0.98, 0.98, 1.0),
		dawn: new THREE.Color(1.0, 0.85, 0.75),
		dusk: new THREE.Color(1.0, 0.7, 0.6),
		night: new THREE.Color(0.25, 0.28, 0.38),
	};

	// Generate cloud shader material
	function createCloudMaterial(): THREE.ShaderMaterial {
		return new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: Math.random() * 100 },
				uOpacity: { value: 0.6 },
				uColor: { value: new THREE.Color(1, 1, 1) },
				uScale: { value: 1.0 },
			},
			vertexShader: `
				varying vec2 vUv;
				varying float vFog;
				void main() {
					vUv = uv;
					vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
					// Distance fog
					vFog = smoothstep(50.0, 200.0, -mvPosition.z);
					gl_Position = projectionMatrix * mvPosition;
				}
			`,
			fragmentShader: `
				uniform float uTime;
				uniform float uOpacity;
				uniform vec3 uColor;
				uniform float uScale;
				varying vec2 vUv;
				varying float vFog;

				float hash(vec2 p) {
					return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
				}

				float noise(vec2 p) {
					vec2 i = floor(p);
					vec2 f = fract(p);
					f = f * f * (3.0 - 2.0 * f);
					return mix(
						mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
						mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
						f.y
					);
				}

				float fbm(vec2 p) {
					float v = 0.0;
					float a = 0.5;
					mat2 rot = mat2(0.87, 0.5, -0.5, 0.87);
					for (int i = 0; i < 5; i++) {
						v += a * noise(p);
						p = rot * p * 2.0;
						a *= 0.5;
					}
					return v;
				}

				void main() {
					vec2 uv = vUv;
					vec2 center = uv - 0.5;
					float dist = length(center);

					// Circular cloud shape with soft edges
					float circle = 1.0 - smoothstep(0.2, 0.5, dist);

					// Organic noise texture
					float t = uTime * 0.02;
					vec2 noiseUv = uv * 3.0 * uScale;
					float n = fbm(noiseUv + t);
					float n2 = fbm(noiseUv * 2.0 - t * 0.5 + 10.0);

					// Combine for fluffy cloud
					float cloud = circle * smoothstep(0.3, 0.6, n * 0.6 + n2 * 0.4);

					// Edge detail
					float edge = smoothstep(0.15, 0.45, dist);
					cloud *= mix(1.0, n2, edge * 0.5);

					// Apply opacity and distance fog
					float alpha = cloud * uOpacity * (1.0 - vFog * 0.7);

					if (alpha < 0.02) discard;

					// Slight brightness variation
					float brightness = 0.9 + n * 0.15;

					gl_FragColor = vec4(uColor * brightness, alpha);
				}
			`,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.NormalBlending,
		});
	}

	// Cloud instances
	interface CloudInstance {
		mesh: THREE.Mesh;
		material: THREE.ShaderMaterial;
		velocity: THREE.Vector3;
		baseY: number;
		scale: number;
		seed: number;
		depthFactor: number;
		lastAppliedScale: number; // Cache to avoid unnecessary scale updates
	}

	const clouds: CloudInstance[] = [];
	const cloudGroup = new THREE.Group();

	// Initialize clouds - spread across the view at different depths
	function initClouds() {
		for (let i = 0; i < CLOUD_COUNT; i++) {
			const material = createCloudMaterial();
			// MUCH bigger base geometry for voluminous clouds
			const geometry = new THREE.PlaneGeometry(60, 50);
			const mesh = new THREE.Mesh(geometry, material);

			// Random depth (Z) - some close, some far
			const depth = CLOUD_DEPTH_MIN + Math.random() * (CLOUD_DEPTH_MAX - CLOUD_DEPTH_MIN);
			mesh.position.z = depth;

			// Random starting X position (spread across the view)
			mesh.position.x = CLOUD_SPAWN_X + Math.random() * (CLOUD_EXIT_X - CLOUD_SPAWN_X);

			// Random Y position
			mesh.position.y = CLOUD_MIN_Y + Math.random() * (CLOUD_MAX_Y - CLOUD_MIN_Y);

			// Face camera with slight random tilt
			mesh.rotation.x = (Math.random() - 0.5) * 0.1;
			mesh.rotation.z = (Math.random() - 0.5) * 0.15;

			// Random scale - closer clouds bigger, use model.cloudScale
			const depthFactor = 1 - (depth - CLOUD_DEPTH_MAX) / (CLOUD_DEPTH_MIN - CLOUD_DEPTH_MAX);
			const baseScale = (0.6 + Math.random() * 0.8) * (0.7 + depthFactor * 0.5);
			mesh.scale.set(baseScale, baseScale * 0.75, 1);

			// Speed based on depth (parallax - closer = faster)
			// POSITIVE X = moving RIGHT (from front to back of plane)
			const speed = 3 + depthFactor * 8; // Slower base speed

			clouds.push({
				mesh,
				material,
				velocity: new THREE.Vector3(speed, 0, 0), // Moving RIGHT (plane flying, clouds drift back)
				baseY: mesh.position.y,
				scale: baseScale,
				seed: Math.random() * 100,
				depthFactor,
				lastAppliedScale: baseScale,
			});

			cloudGroup.add(mesh);
		}
	}

	initClouds();

	// Animation - clouds drift SIDEWAYS (side window view)
	let time = 0;
	useTask('clouds-drift', (delta) => {
		time += delta;

		// Use model's cloud speed setting (slower = more realistic)
		const speedMultiplier = model.cloudSpeed * model.flightSpeed;
		const scaleMultiplier = model.cloudScale;

		// Get current cloud color
		const skyColor = CLOUD_COLORS[model.skyState] || CLOUD_COLORS.day;
		let color = skyColor.clone();
		if (model.weather === 'storm') {
			color.multiplyScalar(0.5);
		} else if (model.weather === 'overcast') {
			color.multiplyScalar(0.75);
		}

		const baseOpacity = model.effectiveCloudDensity * 0.8;

		for (const cloud of clouds) {
			// Move clouds RIGHT (from front to back of plane as seen from side window)
			cloud.mesh.position.x += cloud.velocity.x * speedMultiplier * delta;

			// Gentle vertical bobbing
			cloud.mesh.position.y = cloud.baseY + Math.sin(time * 0.15 + cloud.seed) * 3;

			// Apply scale from model (only if changed to avoid unnecessary matrix updates)
			const finalScale = cloud.scale * scaleMultiplier;
			if (Math.abs(finalScale - cloud.lastAppliedScale) > 0.01) {
				cloud.mesh.scale.set(finalScale, finalScale * 0.75, 1);
				cloud.lastAppliedScale = finalScale;
			}

			// Respawn when cloud exits RIGHT side of view
			if (cloud.mesh.position.x > CLOUD_EXIT_X) {
				// Respawn on the LEFT side (front of plane)
				cloud.mesh.position.x = CLOUD_SPAWN_X - Math.random() * 20;

				// New random depth
				const depth = CLOUD_DEPTH_MIN + Math.random() * (CLOUD_DEPTH_MAX - CLOUD_DEPTH_MIN);
				cloud.mesh.position.z = depth;

				// New Y position
				cloud.baseY = CLOUD_MIN_Y + Math.random() * (CLOUD_MAX_Y - CLOUD_MIN_Y);
				cloud.mesh.position.y = cloud.baseY;

				// Recalculate speed based on new depth (parallax)
				cloud.depthFactor = 1 - (depth - CLOUD_DEPTH_MAX) / (CLOUD_DEPTH_MIN - CLOUD_DEPTH_MAX);
				cloud.velocity.x = 3 + cloud.depthFactor * 8;

				// New random seed for noise variation
				cloud.seed = Math.random() * 100;

				// Resize based on depth
				cloud.scale = (0.6 + Math.random() * 0.8) * (0.7 + cloud.depthFactor * 0.5);
				cloud.lastAppliedScale = 0; // Force scale update on next frame
			}

			// Update material uniforms
			cloud.material.uniforms.uTime.value = time + cloud.seed;
			cloud.material.uniforms.uColor.value.copy(color);
			cloud.material.uniforms.uOpacity.value = baseOpacity;
			cloud.material.uniforms.uScale.value = cloud.scale * scaleMultiplier;
		}
	});

	// Cleanup
	$effect(() => {
		return () => {
			for (const cloud of clouds) {
				cloud.material.dispose();
				cloud.mesh.geometry.dispose();
			}
			clouds.length = 0;
		};
	});
</script>

{#if model.showClouds}
	<T is={cloudGroup} />
{/if}
