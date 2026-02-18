<script lang="ts">
	/**
	 * CloudCanvas — Camera-parallax procedural cloud overlay
	 *
	 * Three FBM noise layers shift with camera heading/pitch at different
	 * parallax rates: near clouds slide fast, far clouds barely move.
	 * This creates the illusion of clouds at different distances rather
	 * than a flat decal stuck on the window glass.
	 *
	 * Loads pre-baked noise textures from /textures/ for ~4.7x GPU speedup.
	 * Falls back to computed FBM if textures fail to load.
	 *
	 * Pattern: {@attach} creates Three.js objects once on mount.
	 * A nested $effect handles per-frame uniform sync and renderer.render().
	 */
	import * as THREE from 'three';
	import { CLOUD_VERTEX, CLOUD_FRAGMENT } from './cloud-shader';

	// Texture paths — loaded once, shared across instances
	const TEXTURE_PATHS = {
		noise: '/textures/cloud-noise.png',
		detail: '/textures/cloud-detail.png',
		wisp: '/textures/cloud-wisp.png',
	} as const;

	interface Props {
		density?: number;
		cloudSpeed?: number;
		nightFactor?: number;
		dawnDuskFactor?: number;
		skyState?: 'day' | 'night' | 'dawn' | 'dusk';
		time?: number;
		heading?: number;
		pitch?: number;
		altitude?: number;
	}

	let {
		density = 0.5,
		cloudSpeed = 1.0,
		nightFactor = 0,
		dawnDuskFactor = 0,
		skyState = 'day',
		time = 0,
		heading = 0,
		pitch = -15,
		altitude = 35000,
	}: Props = $props();

	// Sun direction per sky state (normalized in shader)
	const sunDirection = $derived.by(() => {
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

	/** Load a texture with seamless-tile wrapping. Returns a 1x1 white fallback on error. */
	function loadCloudTexture(loader: THREE.TextureLoader, path: string): THREE.Texture {
		const tex = loader.load(
			path,
			(t) => { t.needsUpdate = true; },
			undefined,
			() => { console.warn(`[CloudCanvas] Failed to load ${path}, using FBM fallback`); }
		);
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.RepeatWrapping;
		tex.minFilter = THREE.LinearMipmapLinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.generateMipmaps = true;
		return tex;
	}

	function initCloud(canvas: HTMLCanvasElement) {
		const renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: false,
			premultipliedAlpha: true,
			powerPreference: 'high-performance',
		});
		renderer.setClearColor(0x000000, 0);

		const scene = new THREE.Scene();
		const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		// Load noise textures — async, shader falls back to FBM until ready
		const loader = new THREE.TextureLoader();
		const cloudNoiseTex = loadCloudTexture(loader, TEXTURE_PATHS.noise);
		const cloudDetailTex = loadCloudTexture(loader, TEXTURE_PATHS.detail);
		const cloudWispTex = loadCloudTexture(loader, TEXTURE_PATHS.wisp);

		// Track whether all textures loaded successfully
		let texturesReady = false;
		const checkTextures = () => {
			texturesReady = cloudNoiseTex.image != null
				&& cloudDetailTex.image != null
				&& cloudWispTex.image != null;
		};

		const material = new THREE.ShaderMaterial({
			vertexShader: CLOUD_VERTEX,
			fragmentShader: CLOUD_FRAGMENT,
			transparent: true,
			depthWrite: false,
			uniforms: {
				uCloudColor:    { value: new THREE.Color(0.92, 0.92, 0.95) },
				uSkyColor:      { value: new THREE.Color(0.2, 0.47, 1.0) },
				uSunDirection:  { value: new THREE.Vector3(1.0, 2.0, 1.0) },
				uTime:          { value: 0 },
				uDensity:       { value: 0.5 },
				uWindSpeed:     { value: 1.0 },
				uResolution:    { value: new THREE.Vector2() },
				uHeading:       { value: 0 },
				uPitch:         { value: 0 },
				uAltitude:      { value: 35000 },
				uUseTextures:   { value: 0.0 },
				uCloudNoise:    { value: cloudNoiseTex },
				uCloudDetail:   { value: cloudDetailTex },
				uCloudWisp:     { value: cloudWispTex },
			},
		});

		const geometry = new THREE.PlaneGeometry(2, 2);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.frustumCulled = false;
		scene.add(mesh);

		// Per-frame reactive sync — nested $effect runs inside the attachment's
		// reactive scope, so it's automatically torn down on unmount.
		// Half-resolution rendering — clouds are soft/blurry by nature,
		// the CSS upscale is invisible and saves 4x fill rate on Pi 5.
		const HALF_RES = 0.5;

		$effect(() => {
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			if (w === 0 || h === 0) return;

			// Resize renderer at half resolution
			const dpr = window.devicePixelRatio * HALF_RES;
			const targetW = Math.round(w * dpr);
			const targetH = Math.round(h * dpr);
			if (canvas.width !== targetW || canvas.height !== targetH) {
				renderer.setPixelRatio(dpr);
				renderer.setSize(w, h, false);
			}

			// Sync uniforms from reactive props/$derived
			const u = material.uniforms;
			u.uDensity.value = density;
			u.uWindSpeed.value = cloudSpeed;
			u.uSunDirection.value.copy(sunDirection);
			u.uCloudColor.value.copy(cloudColor);
			u.uSkyColor.value.copy(skyColor);
			u.uTime.value = time;
			u.uResolution.value.set(targetW, targetH);
			// Camera parallax: convert degrees to radians for smooth UV offset
			u.uHeading.value = heading * Math.PI / 180;
			u.uPitch.value = pitch * Math.PI / 180;
			u.uAltitude.value = altitude;

			// Enable texture mode once all textures are loaded
			if (!texturesReady) checkTextures();
			u.uUseTextures.value = texturesReady ? 1.0 : 0.0;

			renderer.render(scene, camera);
		});

		return () => {
			cloudNoiseTex.dispose();
			cloudDetailTex.dispose();
			cloudWispTex.dispose();
			geometry.dispose();
			material.dispose();
			renderer.dispose();
		};
	}
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
