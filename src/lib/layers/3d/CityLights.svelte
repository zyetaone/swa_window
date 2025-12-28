<script lang="ts">
	/**
	 * CityLights - Ground-fixed city lights
	 *
	 * Uses THREE.Points at fixed ground level
	 * Lights stay stationary on ground as plane flies over
	 */
	import { T, useTask } from "@threlte/core";
	import * as THREE from "three";
	import { useAppState } from "$lib/core";
	import { BLOOM_LAYER } from "$lib/plugins";

	const { model } = useAppState();

	// Configuration
	const NUM_LIGHTS = 800;
	const SPREAD = 50000; // meters spread
	const GROUND_LEVEL = -10000; // Fixed depth below camera (represents ground)

	// HDR colors (warm city lights)
	const COLORS = [
		[1.5, 1.2, 0.8],   // Warm yellow
		[1.4, 1.0, 0.6],   // Orange-yellow
		[1.3, 1.3, 1.0],   // White-ish
		[1.2, 0.9, 0.5],   // Deep orange
	];

	// Generate static positions once
	const positions = new Float32Array(NUM_LIGHTS * 3);
	const colors = new Float32Array(NUM_LIGHTS * 3);
	const sizes = new Float32Array(NUM_LIGHTS);

	for (let i = 0; i < NUM_LIGHTS; i++) {
		// Spread lights on ground plane
		positions[i * 3] = (Math.random() - 0.5) * SPREAD;
		positions[i * 3 + 1] = GROUND_LEVEL + Math.random() * 50; // Small height variation
		positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;

		const c = COLORS[Math.floor(Math.random() * COLORS.length)];
		colors[i * 3] = c[0];
		colors[i * 3 + 1] = c[1];
		colors[i * 3 + 2] = c[2];

		sizes[i] = 40 + Math.random() * 60;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

	const material = new THREE.ShaderMaterial({
		uniforms: {
			opacity: { value: 1.0 },
			brightness: { value: 1.0 }
		},
		vertexShader: `
			attribute float size;
			attribute vec3 color;
			varying vec3 vColor;
			void main() {
				vColor = color;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = clamp(size * (500.0 / -mv.z), 1.0, 40.0);
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: `
			uniform float opacity;
			uniform float brightness;
			varying vec3 vColor;
			void main() {
				float d = length(gl_PointCoord - 0.5) * 2.0;
				if (d > 1.0) discard;
				float glow = (1.0 - d * d);
				vec3 hdrColor = vColor * brightness * glow;
				gl_FragColor = vec4(hdrColor, glow * opacity);
			}
		`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		toneMapped: false,
	});

	const points = new THREE.Points(geometry, material);
	points.layers.enable(BLOOM_LAYER);

	// Derived
	const visible = $derived(model.skyState === "night" || model.skyState === "dusk");
	const opacity = $derived(model.skyState === "night" ? 1.0 : model.skyState === "dusk" ? 0.6 : 0);
	const brightness = $derived(model.nightLightIntensity);

	// Update uniforms
	useTask('city-lights', () => {
		material.uniforms.opacity.value = opacity;
		material.uniforms.brightness.value = brightness;
	});

	// Cleanup
	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});
</script>

{#if visible}
	<T is={points} />
{/if}
