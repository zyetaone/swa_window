<script lang="ts">
	/**
	 * CityLights - Static ambient city lights
	 *
	 * Simple decorative lights - no movement tracking.
	 * Cesium handles world movement, these are just atmosphere.
	 */
	import { T } from "@threlte/core";
	import * as THREE from "three";
	import { useAppState } from "$lib/core";
	import { BLOOM_LAYER } from "$lib/plugins";

	const { model } = useAppState();

	// Configuration
	const NUM_LIGHTS = 500;
	const SPREAD_X = 80000;
	const SPREAD_Z = 60000;
	const GROUND_LEVEL = -12000;

	// HDR colors (warm city lights)
	const COLORS = [
		[1.5, 1.2, 0.8],
		[1.4, 1.0, 0.6],
		[1.3, 1.3, 1.0],
		[1.2, 0.9, 0.5],
	];

	// Generate static positions once
	const positions = new Float32Array(NUM_LIGHTS * 3);
	const colors = new Float32Array(NUM_LIGHTS * 3);
	const sizes = new Float32Array(NUM_LIGHTS);

	for (let i = 0; i < NUM_LIGHTS; i++) {
		positions[i * 3] = (Math.random() - 0.5) * SPREAD_X;
		positions[i * 3 + 1] = GROUND_LEVEL + Math.random() * 100;
		positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_Z;

		const c = COLORS[Math.floor(Math.random() * COLORS.length)];
		colors[i * 3] = c[0];
		colors[i * 3 + 1] = c[1];
		colors[i * 3 + 2] = c[2];

		sizes[i] = 30 + Math.random() * 50;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

	// Derived values for shader uniforms
	const opacity = $derived(model.skyState === "night" ? 1.0 : model.skyState === "dusk" ? 0.5 : 0);
	const brightness = $derived(model.nightLightIntensity);

	const material = new THREE.ShaderMaterial({
		uniforms: {
			opacity: { value: opacity },
			brightness: { value: brightness }
		},
		vertexShader: `
			attribute float size;
			attribute vec3 color;
			varying vec3 vColor;
			void main() {
				vColor = color;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = clamp(size * (400.0 / -mv.z), 1.0, 30.0);
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

	// Update uniforms reactively
	$effect(() => {
		material.uniforms.opacity.value = opacity;
		material.uniforms.brightness.value = brightness;
	});

	// Derived visibility
	const visible = $derived(model.skyState === "night" || model.skyState === "dusk");

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
