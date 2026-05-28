<script lang="ts">
	/**
	 * NightStars — twinkling additive star field, visible at deep night.
	 *
	 * Three.js Points + ShaderMaterial. Per-star phase offset attribute
	 * drives a sin() twinkle in the vertex shader; uTime is bumped by
	 * useTask each frame. Fades in with model.nightFactor so the stars
	 * only assert themselves once Cesium's sky is dark enough not to
	 * wash them out.
	 *
	 * Lives on top of Cesium's own celestial sphere. Cesium's stars are
	 * essentially static — these twinkle and add depth across the deep-
	 * night window of the show.
	 */
	import { T, useTask } from '@threlte/core';
	import {
		BufferGeometry,
		BufferAttribute,
		AdditiveBlending,
		ShaderMaterial,
		Points,
	} from 'three';
	import { useAeroWindow } from '$lib/model/aero-window.svelte';
	import { STARS_RADIUS_M } from './state.svelte';
	import { airMassFactor } from './sky';

	const model = useAeroWindow();

	let {
		ambientIntensity = 1,
	}: {
		ambientIntensity?: number;
	} = $props();

	const STAR_COUNT = 800;

	// Pre-allocate position + per-star phase. Spherical distribution via
	// the standard u/v → (θ, φ) transform — uniform across the sphere.
	const positions = new Float32Array(STAR_COUNT * 3);
	const phases = new Float32Array(STAR_COUNT);
	for (let i = 0; i < STAR_COUNT; i++) {
		const u = Math.random();
		const v = Math.random();
		const theta = 2 * Math.PI * u;
		const phi = Math.acos(2 * v - 1);
		const r = STARS_RADIUS_M;
		positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
		positions[i * 3 + 1] = r * Math.cos(phi);
		positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
		phases[i] = Math.random() * Math.PI * 2;
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));

	const material = new ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uVisibility: { value: 0 },
		},
		vertexShader: /* glsl */ `
			attribute float aPhase;
			uniform float uTime;
			uniform float uVisibility;
			varying float vAlpha;
			void main() {
				// 0.6-1.0 twinkle range — never fully dark so the constellation
				// stays readable even at trough of the oscillation.
				float twinkle = 0.6 + 0.4 * sin(uTime * 0.9 + aPhase * 3.0);
				vAlpha = uVisibility * twinkle;
				vec4 mv = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mv;
				// sizeAttenuation false-equivalent: fixed pixel size.
				gl_PointSize = 2.6;
			}
		`,
		fragmentShader: /* glsl */ `
			varying float vAlpha;
			void main() {
				vec2 uv = gl_PointCoord - 0.5;
				float d = length(uv);
				// Soft round disk via smoothstep.
				float a = smoothstep(0.5, 0.05, d);
				gl_FragColor = vec4(1.0, 1.0, 1.0, a * vAlpha);
			}
		`,
	});

	const points = new Points(geometry, material);

	useTask((dt) => {
		material.uniforms.uTime.value += dt;
		// Only assert at deep night — nightFactor → ~1.0. Cesium's own
		// stars cover the dusk transition; these are the deep-night punch.
		// Slight airMass + ambient harmony modulation.
		const am = airMassFactor(model.flight.camLon, model.timeOfDay);
		const amFactor = 1 + Math.min(0.4, (am - 1) * 0.08);
		const ai = ambientIntensity ?? 1;
		material.uniforms.uVisibility.value = Math.max(0, model.nightFactor - 0.4) * 1.5 * amFactor * ai;
	});

	$effect(() => () => {
		geometry.dispose();
		material.dispose();
	});
</script>

<T is={points} />
