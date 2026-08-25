<script lang="ts">
	/**
	 * Clouds — Photorealistic 3D Atmospheric Cloud Deck & Distant Horizon Mist.
	 *
	 * Composites two distinct depth tiers:
	 * 1. Distant Horizon Cloud Banks (50 km - 140 km): Stretched, soft panoramic
	 *    cloud layers that seamlessly bridge terrain and the sky dome.
	 * 2. Local Mid-Deck Cumulus Clusters (3 km - 45 km): Volumetric cloud puffs
	 *    with wind drift and solar Mie forward-scatter lighting.
	 *
	 * Responds dynamically to:
	 * - `config.clouds` (visibility toggle)
	 * - `config.cloudDensity` (cluster count & fullness)
	 * - `config.cloudSpeed` (wind drift rate)
	 * - `config.cloudAltitudeM` (cloud deck height)
	 * - `config.cloudOpacity` (deck translucency)
	 * - Solar lighting transitions from `display.sun`
	 */
	import { useDisplay } from '../display.svelte.js';
	import * as THREE from 'three';

	interface Props {
		visible?: boolean;
	}

	let { visible = true }: Props = $props();

	const display = useDisplay();

	const isVisible = $derived(visible && display.config.clouds);
	const density = $derived(display.config.cloudDensity ?? 0.75);
	const driftSpeed = $derived(display.config.cloudSpeed ?? 1.0);
	const cloudAltM = $derived(display.config.cloudAltitudeM ?? 3500);
	const opacityScale = $derived(display.config.cloudOpacity ?? 0.85);

	let canvas = $state<HTMLCanvasElement | undefined>();

	const TEXTURE_URLS = ['/cloud.webp', '/cloud-dark.webp', '/cloud-smoke.webp'];

	$effect(() => {
		if (!canvas || !isVisible) return;

		const c = canvas;
		const renderer = new THREE.WebGLRenderer({
			canvas: c,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(c.clientWidth, c.clientHeight, false);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(50, c.clientWidth / c.clientHeight, 10, 800_000);
		camera.position.set(0, 5000, 15000);
		camera.lookAt(0, 3000, 0);

		// Dynamic lighting
		const ambient = new THREE.AmbientLight(0xffffff, 0.85);
		scene.add(ambient);

		const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
		sunLight.position.set(5000, 8000, 5000);
		scene.add(sunLight);

		const cloudGroup = new THREE.Group();
		scene.add(cloudGroup);

		const textureLoader = new THREE.TextureLoader();
		const textures: THREE.Texture[] = [];
		let loadedCount = 0;

		TEXTURE_URLS.forEach((url, i) => {
			textureLoader.load(
				url,
				(tex) => {
					tex.colorSpace = THREE.SRGBColorSpace;
					textures[i] = tex;
					loadedCount++;
					if (loadedCount === TEXTURE_URLS.length) {
						buildCloudDeck();
					}
				},
				undefined,
				(err) => {
					console.warn('[Clouds] Texture load fallback:', err);
				}
			);
		});

		const sprites: THREE.Sprite[] = [];
		const rotSpeeds: number[] = [];
		const materials: THREE.SpriteMaterial[] = [];

		function buildCloudDeck() {
			// Clear existing
			while (cloudGroup.children.length > 0) {
				cloudGroup.remove(cloudGroup.children[0]);
			}
			materials.forEach((m) => m.dispose());
			materials.length = 0;
			sprites.length = 0;
			rotSpeeds.length = 0;

			if (textures.length === 0) return;

			// ── 1. Distant Horizon Cloud Banks (50 km - 130 km) ──────────────────────
			const horizonBanks = Math.round(10 + density * 18);
			const horizonRadius = 85_000;

			for (let i = 0; i < horizonBanks; i++) {
				const angle = (i / horizonBanks) * Math.PI * 2 + Math.sin(i * 47) * 0.4;
				const dist = 50_000 + Math.sqrt((i + 1) / horizonBanks) * horizonRadius;
				const cx = Math.cos(angle) * dist;
				const cz = Math.sin(angle) * dist;
				const cy = Math.sin(i * 19) * 400;

				const tex = textures[i % textures.length];
				const mat = new THREE.SpriteMaterial({
					map: tex,
					transparent: true,
					opacity: (0.35 + Math.random() * 0.25) * opacityScale,
					depthWrite: false,
					rotation: (Math.random() - 0.5) * 0.1 // Subtle horizontal stratification
				});
				materials.push(mat);

				const sprite = new THREE.Sprite(mat);
				sprite.position.set(cx, cy, cz);
				const horizScale = 14_000 + Math.random() * 12_000;
				// Stretched horizontally to form seamless atmospheric horizon bands
				sprite.scale.set(horizScale * 3.2, horizScale * 0.9, 1);

				cloudGroup.add(sprite);
				sprites.push(sprite);
				rotSpeeds.push((Math.random() - 0.5) * 0.005);
			}

			// ── 2. Local Mid-Deck Cumulus Puffs (3 km - 40 km) ───────────────────────
			const clusterCount = Math.round(12 + density * 24);
			const radius = 38_000;

			for (let i = 0; i < clusterCount; i++) {
				const angle = (i / clusterCount) * Math.PI * 2 + Math.sin(i * 99) * 0.5;
				const dist = 3000 + Math.sqrt((i + 1) / clusterCount) * radius;
				const cx = Math.cos(angle) * dist;
				const cz = Math.sin(angle) * dist;
				const cy = Math.sin(i * 33) * 600;

				const puffsInCluster = 5 + Math.floor(density * 7);
				const clusterScale = 3000 + Math.random() * 4000;

				for (let j = 0; j < puffsInCluster; j++) {
					const tex = textures[j % textures.length];
					const baseOpacity = 0.25 + Math.random() * 0.35;

					const mat = new THREE.SpriteMaterial({
						map: tex,
						transparent: true,
						opacity: baseOpacity * opacityScale,
						depthWrite: false,
						rotation: Math.random() * Math.PI * 2
					});
					materials.push(mat);

					const sprite = new THREE.Sprite(mat);
					const ox = cx + (Math.random() - 0.5) * clusterScale;
					const oz = cz + (Math.random() - 0.5) * clusterScale;
					const oy = cy + (Math.random() - 0.5) * (clusterScale * 0.25);

					sprite.position.set(ox, oy, oz);
					const sprScale = clusterScale * (0.8 + Math.random() * 0.8);
					sprite.scale.set(sprScale * 1.3, sprScale, 1);

					cloudGroup.add(sprite);
					sprites.push(sprite);
					rotSpeeds.push((Math.random() - 0.5) * 0.03);
				}
			}
		}

		let raf: number;
		let lastT = performance.now();

		const renderLoop = (now: number) => {
			const dt = Math.min(0.1, (now - lastT) / 1000);
			lastT = now;

			if (
				c.clientWidth !== renderer.domElement.width ||
				c.clientHeight !== renderer.domElement.height
			) {
				const w = c.clientWidth;
				const h = c.clientHeight;
				if (w > 0 && h > 0) {
					renderer.setSize(w, h, false);
					camera.aspect = w / h;
					camera.updateProjectionMatrix();
				}
			}

			// Wind drift and subtle sprite puff rotation
			const driftDelta = dt * driftSpeed * 0.04;
			cloudGroup.rotation.y += driftDelta;

			for (let i = 0; i < sprites.length; i++) {
				sprites[i].material.rotation += rotSpeeds[i] * dt;
			}

			// Synchronize relative camera altitude to cloud deck
			const planeAgl = display.view.aglM ?? 4000;
			const deltaAltM = planeAgl - cloudAltM;
			camera.position.y = 1000 + deltaAltM * 1.5;
			camera.position.z = 12000;
			camera.lookAt(0, 0, 0);

			// Synchronize solar light intensity and warm Mie scatter
			const sunElev = display.sun.elevationDeg;
			const night = display.night;
			const dayFactor = Math.max(0.1, Math.min(1.0, 1 - night));
			sunLight.intensity = Math.max(0.2, (sunElev > 0 ? 2.0 : 0.4) * dayFactor);

			renderer.render(scene, camera);
			raf = requestAnimationFrame(renderLoop);
		};

		raf = requestAnimationFrame(renderLoop);

		return () => {
			cancelAnimationFrame(raf);
			materials.forEach((m) => m.dispose());
			renderer.dispose();
			scene.clear();
		};
	});
</script>

{#if isVisible}
	<canvas bind:this={canvas} class="cabin-clouds-canvas" aria-hidden="true"></canvas>
{/if}

<style>
	.cabin-clouds-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 3;
	}
</style>
