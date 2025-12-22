<script lang="ts">
	/**
	 * VolumetricClouds - Simplified cloud rendering
	 *
	 * Uses billboard sprites with procedural noise in shader
	 * Removed: 3D noise texture generation, complex light scattering
	 */
	import { T, useTask } from '@threlte/core';
	import * as THREE from 'three';
	import { useAppState } from '$lib/core';

	const { model } = useAppState();

	// Configuration
	const MAX_CLOUDS = 200;

	// Cloud colors by time of day
	const CLOUD_COLORS: Record<string, [number, number, number]> = {
		day: [1.0, 1.0, 1.0],
		dawn: [1.0, 0.85, 0.75],
		dusk: [1.0, 0.75, 0.65],
		night: [0.3, 0.35, 0.45],
	};

	// Simple cloud shader with procedural noise
	const cloudMaterial = new THREE.ShaderMaterial({
		uniforms: {
			time: { value: 0 },
			opacity: { value: 1.0 },
			cloudColor: { value: new THREE.Color(1, 1, 1) },
		},
		vertexShader: `
			attribute float size;
			attribute float alpha;
			varying float vAlpha;
			varying vec2 vUv;
			void main() {
				vAlpha = alpha;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_PointSize = clamp(size * (500.0 / -mv.z), 10.0, 300.0);
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: `
			uniform float time;
			uniform float opacity;
			uniform vec3 cloudColor;
			varying float vAlpha;

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

			void main() {
				vec2 uv = gl_PointCoord;
				float d = length(uv - 0.5) * 2.0;
				if (d > 1.0) discard;

				// Procedural cloud shape
				float n = noise(uv * 8.0 + time * 0.1) * 0.5 +
				          noise(uv * 16.0 - time * 0.05) * 0.3 +
				          noise(uv * 32.0) * 0.2;

				float edge = smoothstep(1.0, 0.3, d);
				float density = smoothstep(0.3, 0.6, n) * edge;

				float alpha = density * vAlpha * opacity;
				if (alpha < 0.05) discard;

				gl_FragColor = vec4(cloudColor, alpha);
			}
		`,
		transparent: true,
		depthWrite: false,
	});

	// Generate cloud positions
	function generateClouds(): { positions: Float32Array; sizes: Float32Array; alphas: Float32Array; count: number } {
		const alt = model.altitude;
		const clouds: { x: number; y: number; z: number; size: number; alpha: number }[] = [];

		// Cloud layers relative to altitude
		const layers = [
			{ minAlt: 3000, maxAlt: 12000, density: 1.0 },
			{ minAlt: 12000, maxAlt: 25000, density: 0.7 },
			{ minAlt: 25000, maxAlt: 40000, density: 0.4 },
		];

		for (const layer of layers) {
			const distance = Math.abs(alt - (layer.minAlt + layer.maxAlt) / 2);
			if (distance > 30000) continue;

			const count = Math.floor(60 * layer.density * model.cloudDensity * Math.max(0.3, 1 - distance / 30000));

			for (let i = 0; i < count && clouds.length < MAX_CLOUDS; i++) {
				const angle = Math.random() * Math.PI * 2;
				const dist = 2000 + Math.random() * 40000;
				const layerAlt = layer.minAlt + Math.random() * (layer.maxAlt - layer.minAlt);

				clouds.push({
					x: Math.cos(angle) * dist,
					y: (layerAlt - alt) * 0.3048, // feet to meters
					z: Math.sin(angle) * dist,
					size: 800 + Math.random() * 2000,
					alpha: 0.4 + Math.random() * 0.4,
				});
			}
		}

		const positions = new Float32Array(clouds.length * 3);
		const sizes = new Float32Array(clouds.length);
		const alphas = new Float32Array(clouds.length);

		clouds.forEach((c, i) => {
			positions[i * 3] = c.x;
			positions[i * 3 + 1] = c.y;
			positions[i * 3 + 2] = c.z;
			sizes[i] = c.size;
			alphas[i] = c.alpha;
		});

		return { positions, sizes, alphas, count: clouds.length };
	}

	// Create geometry
	const geometry = new THREE.BufferGeometry();
	let lastAltitude = model.altitude;
	let lastDensity = model.cloudDensity;

	function updateGeometry() {
		const data = generateClouds();
		geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute('size', new THREE.BufferAttribute(data.sizes, 1));
		geometry.setAttribute('alpha', new THREE.BufferAttribute(data.alphas, 1));
		geometry.setDrawRange(0, data.count);
	}

	updateGeometry();
	const points = new THREE.Points(geometry, cloudMaterial);

	// State
	let time = 0;
	let driftX = 0;
	let driftZ = 0;

	// Animation
	useTask('clouds', (delta) => {
		time += delta;
		driftX = Math.sin(time * 0.02) * 500;
		driftZ = time * 30;

		cloudMaterial.uniforms.time.value = time;
		cloudMaterial.uniforms.opacity.value = model.cloudDensity;

		const color = CLOUD_COLORS[model.skyState] || CLOUD_COLORS.day;
		cloudMaterial.uniforms.cloudColor.value.setRGB(color[0], color[1], color[2]);

		// Regenerate if altitude/density changed significantly
		if (Math.abs(model.altitude - lastAltitude) > 3000 || Math.abs(model.cloudDensity - lastDensity) > 0.2) {
			updateGeometry();
			lastAltitude = model.altitude;
			lastDensity = model.cloudDensity;
		}
	});

	// Update points position reactively
	$effect(() => {
		points.position.set(driftX, 0, driftZ);
	});

	// Cleanup
	$effect(() => {
		return () => {
			geometry.dispose();
			cloudMaterial.dispose();
		};
	});
</script>

{#if model.showClouds}
	<T is={points} />
{/if}
