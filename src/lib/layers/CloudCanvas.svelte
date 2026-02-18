<script lang="ts">
	/**
	 * CloudCanvas — Raw Three.js volumetric cloud overlay
	 *
	 * Uses {@attach} + raw Three.js (same pattern as CesiumViewer)
	 * instead of Threlte's <Canvas> to keep the rendering pipeline transparent.
	 * Renders FBM raymarched clouds on a fullscreen quad with premultiplied alpha.
	 */
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

	// Sun position per sky state
	const sunPosition = $derived.by(() => {
		switch (skyState) {
			case 'dawn':  return new THREE.Vector3(-1.0, 0.5, 1.0);
			case 'dusk':  return new THREE.Vector3(1.0, 0.3, -1.0);
			case 'night': return new THREE.Vector3(0.0, -1.0, 0.0);
			default:      return new THREE.Vector3(1.0, 2.0, 1.0);
		}
	});

	// Cloud color: circadian tinting
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

	const cloudSteps = $derived(nightFactor > 0.7 ? 12 : 16);

	// Three.js objects — created once in {@attach}, synced in $effect
	let renderer: THREE.WebGLRenderer | null = null;
	let material: THREE.ShaderMaterial | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.OrthographicCamera | null = null;

	function initCloud(canvas: HTMLCanvasElement) {
		// Create renderer with transparent background
		renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: false,
			premultipliedAlpha: true,
			powerPreference: 'high-performance',
		});
		renderer.setClearColor(0x000000, 0);
		renderer.setPixelRatio(window.devicePixelRatio);

		scene = new THREE.Scene();
		camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		material = new THREE.ShaderMaterial({
			vertexShader: CLOUD_VERTEX,
			fragmentShader: CLOUD_FRAGMENT,
			transparent: true,
			depthWrite: false,
			uniforms: {
				uCloudSize:      { value: new THREE.Vector3(0.5, 1.0, 0.5) },
				uSunPosition:    { value: new THREE.Vector3(1.0, 2.0, 1.0) },
				uCameraPosition: { value: new THREE.Vector3(8.0, -5.5, 8.0) },
				uCloudColor:     { value: new THREE.Color(0.92, 0.92, 0.95) },
				uSkyColor:       { value: new THREE.Color(0.2, 0.47, 1.0) },
				uCloudSteps:     { value: 16 },
				uShadowSteps:    { value: 3 },
				uCloudLength:    { value: 16 },
				uShadowLength:   { value: 2 },
				uResolution:     { value: new THREE.Vector2() },
				uTime:           { value: 0 },
				uFocalLength:    { value: 2.0 },
				uDensity:        { value: 0.5 },
			},
		});

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			material,
		);
		mesh.frustumCulled = false;
		scene.add(mesh);

		return () => {
			// Cleanup on unmount
			mesh.geometry.dispose();
			material?.dispose();
			renderer?.dispose();
			renderer = null;
			material = null;
			scene = null;
			camera = null;
		};
	}

	// Reactive sync: update uniforms and render each frame
	$effect(() => {
		if (!renderer || !material || !scene || !camera) return;

		const canvas = renderer.domElement;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w === 0 || h === 0) return;

		// Resize renderer if needed
		if (canvas.width !== w * window.devicePixelRatio || canvas.height !== h * window.devicePixelRatio) {
			renderer.setSize(w, h, false);
		}

		// Sync uniforms
		const u = material.uniforms;
		u.uDensity.value = density;
		u.uCloudSteps.value = cloudSteps;
		u.uSunPosition.value.copy(sunPosition);
		u.uCloudColor.value.copy(cloudColor);
		u.uSkyColor.value.copy(skyColor);
		u.uTime.value = time * cloudSpeed;
		u.uResolution.value.set(w * window.devicePixelRatio, h * window.devicePixelRatio);

		// Render directly — no scheduler, no stages, just draw
		renderer.render(scene, camera);
	});
</script>

<canvas class="cloud-canvas" {@attach initCloud}></canvas>

<style>
	.cloud-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
</style>
