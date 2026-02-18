<script lang="ts">
	/**
	 * VolumetricClouds - Threlte scene component
	 *
	 * Creates a fullscreen quad with the FBM raymarching cloud shader.
	 * Must be placed inside a Threlte <Canvas>.
	 */
	import { T, useThrelte } from '@threlte/core';
	import * as THREE from 'three';
	import { CLOUD_VERTEX, CLOUD_FRAGMENT } from './cloud-shader';

	interface Props {
		density?: number;
		cloudSpeed?: number;
		nightFactor?: number;
		dawnDuskFactor?: number;
		skyState?: 'day' | 'night' | 'dawn' | 'dusk';
		time?: number;
	}

	let {
		density = 0.5,
		cloudSpeed = 1.0,
		nightFactor = 0,
		dawnDuskFactor = 0,
		skyState = 'day',
		time = 0,
	}: Props = $props();

	const { size, advance } = useThrelte();

	// Sun position derived from sky state
	const sunPosition = $derived.by(() => {
		switch (skyState) {
			case 'dawn':
				return new THREE.Vector3(-1.0, 0.5, 1.0);
			case 'dusk':
				return new THREE.Vector3(1.0, 0.3, -1.0);
			case 'night':
				return new THREE.Vector3(0.0, -1.0, 0.0);
			default:
				return new THREE.Vector3(1.0, 2.0, 1.0);
		}
	});

	// Cloud color: white during day, blue-gray at night, warm at dawn/dusk
	const cloudColor = $derived.by(() => {
		if (nightFactor > 0.7) return new THREE.Color(0.3, 0.35, 0.5);
		if (dawnDuskFactor > 0.3) return new THREE.Color(0.92, 0.75, 0.42);
		return new THREE.Color(0.92, 0.92, 0.95);
	});

	// Sky color for scattering through clouds
	const skyColor = $derived.by(() => {
		if (nightFactor > 0.7) return new THREE.Color(0.04, 0.04, 0.08);
		if (dawnDuskFactor > 0.3) return new THREE.Color(0.6, 0.4, 0.2);
		return new THREE.Color(0.2, 0.47, 1.0);
	});

	// Cloud steps: reduce for performance at night
	const cloudSteps = $derived(nightFactor > 0.7 ? 16 : 24);

	// Shader material
	const material = new THREE.ShaderMaterial({
		vertexShader: CLOUD_VERTEX,
		fragmentShader: CLOUD_FRAGMENT,
		transparent: true,
		depthWrite: false,
		blending: THREE.NormalBlending,
		uniforms: {
			uCloudSize: { value: new THREE.Vector3(0.5, 1.0, 0.5) },
			uSunPosition: { value: new THREE.Vector3(1.0, 2.0, 1.0) },
			uCameraPosition: { value: new THREE.Vector3(8.0, -5.5, 8.0) },
			uCloudColor: { value: new THREE.Color(0.92, 0.92, 0.95) },
			uSkyColor: { value: new THREE.Color(0.2, 0.47, 1.0) },
			uCloudSteps: { value: 24 },
			uShadowSteps: { value: 4 },
			uCloudLength: { value: 16 },
			uShadowLength: { value: 2 },
			uResolution: { value: new THREE.Vector2() },
			uTime: { value: 0 },
			uFocalLength: { value: 2.0 },
			uDensity: { value: 0.5 },
		},
	});

	// Sync uniforms reactively
	$effect(() => {
		const w = size.current.width;
		const h = size.current.height;

		// Skip rendering until canvas has real dimensions
		if (w === 0 || h === 0) return;

		material.uniforms.uDensity.value = density;
		material.uniforms.uCloudSteps.value = cloudSteps;
		material.uniforms.uSunPosition.value.copy(sunPosition);
		material.uniforms.uCloudColor.value.copy(cloudColor);
		material.uniforms.uSkyColor.value.copy(skyColor);
		material.uniforms.uTime.value = time * cloudSpeed;

		const dpr = window.devicePixelRatio ?? 1;
		material.uniforms.uResolution.value.set(w * dpr, h * dpr);

		// Trigger re-render after uniform update
		advance();
	});

	// Fullscreen quad geometry (clip space -1 to 1)
	const geometry = new THREE.PlaneGeometry(2, 2);
</script>

<!-- Threlte requires a default camera even though the shader bypasses it -->
<T.OrthographicCamera makeDefault args={[-1, 1, 1, -1, 0, 1]} />
<T.Mesh {geometry} {material} frustumCulled={false} />
