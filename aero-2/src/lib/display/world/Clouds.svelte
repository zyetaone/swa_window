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

	/**
	 * Horizontal stretch for distant horizon banks only.
	 *
	 * Safe at 3.2 because those sprites keep a near-zero rotation. Any sprite
	 * that rotates freely must stay square, or its apparent aspect swings with
	 * the angle and identical clouds render wide or squashed at random.
	 */
	const CLOUD = { bankStretch: 3.2 } as const;

	/**
	 * Deterministic PRNG (mulberry32), seeded from the day.
	 *
	 * This deck used twelve `rnd()` calls, so every Pi built a different
	 * sky. Three Pis form ONE window and never exchange state — orbit.ts spells
	 * this out for the flight path, and the same rule binds here: unseeded
	 * randomness splits the wall into three unrelated views, and clouds are the
	 * most visible thing to get wrong across a seam.
	 *
	 * Positions were already deterministic (`Math.sin(i * 47)` and friends); it
	 * was the sizes, opacities and rotations that were not.
	 */
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

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
		const materials: THREE.SpriteMaterial[] = [];

		function buildCloudDeck() {
			// Clear existing
			while (cloudGroup.children.length > 0) {
				cloudGroup.remove(cloudGroup.children[0]);
			}
			materials.forEach((m) => m.dispose());
			materials.length = 0;
			sprites.length = 0;

			if (textures.length === 0) return;

			// Seeded from `phase`, which carries daySeed: the sky is the same on
			// all three panes, and different tomorrow.
			const rnd = mulberry32(Math.floor(display.config.phase * 1_000_003) + 1);

			// ── 1. Distant Horizon Cloud Banks (50 km - 130 km) ──────────────────────
			/**
			 * Enough banks to close the ring, and no more.
			 *
			 * The ring at ~100 km is 628 km around and each bank is 45-83 km
			 * wide, so 23 of them laid 1,470 km of sprite over it -- roughly
			 * 2.3 layers deep, each at 0.35-0.6 alpha. Compounded, that is a
			 * ~78% opaque wall, which is exactly what the window showed: no
			 * horizon, no sky, brown-grey mud edge to edge. Fourteen covers the
			 * ring about 1.4x, which still reads unbroken but lets light
			 * through.
			 */
			const horizonBanks = Math.round(6 + density * 10);
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
					opacity: (0.35 + rnd() * 0.25) * opacityScale,
					depthWrite: false,
					rotation: (rnd() - 0.5) * 0.1 // Subtle horizontal stratification
				});
				materials.push(mat);

				const sprite = new THREE.Sprite(mat);
				sprite.position.set(cx, cy, cz);
				const horizScale = 14_000 + rnd() * 12_000;
				/**
				 * Wide, but only because a distant bank IS wide — and paired with a
				 * near-zero rotation above.
				 *
				 * A Sprite's scale is applied in its own local axes, so stretching
				 * and then rotating shears the texture: at 3.2 x 0.9 a bank rotated
				 * 45 deg renders square and one at 90 deg renders TALL, which is
				 * why some clouds looked squashed. These keep +-0.05 rad of roll,
				 * so the stretch stays horizontal, as a horizon band should.
				 */
				sprite.scale.set(horizScale * CLOUD.bankStretch, horizScale * 0.9, 1);

				cloudGroup.add(sprite);
				sprites.push(sprite);
			}

			// ── 2. Local Mid-Deck Cumulus Puffs (3 km - 40 km) ───────────────────────
			/**
			 * 60 puffs, none nearer than 12 km.
			 *
			 * Was 30 clusters of 10 -- 300 sprites, the nearest at 3 km with the
			 * camera 15 km back, so a single 7 km puff subtended ~45 degrees and
			 * a dozen of them filled the glass. It was also 300 transparent
			 * quads per frame on a Pi 5.
			 */
			const clusterCount = Math.round(6 + density * 8);
			const nearestM = 12_000;
			const radius = 38_000;

			for (let i = 0; i < clusterCount; i++) {
				const angle = (i / clusterCount) * Math.PI * 2 + Math.sin(i * 99) * 0.5;
				const dist = nearestM + Math.sqrt((i + 1) / clusterCount) * radius;
				const cx = Math.cos(angle) * dist;
				const cz = Math.sin(angle) * dist;
				const cy = Math.sin(i * 33) * 600;

				const puffsInCluster = 3 + Math.floor(density * 3);
				const clusterScale = 3000 + rnd() * 4000;

				for (let j = 0; j < puffsInCluster; j++) {
					// Weighted to the bright plate. An even cycle across
					// cloud/cloud-dark/cloud-smoke put a third of the deck in
					// smoke, and smoke stacked on smoke is the brown.
					const tex = textures[rnd() < 0.65 ? 0 : 1 + Math.floor(rnd() * (textures.length - 1))];
					const baseOpacity = 0.25 + rnd() * 0.35;

					const mat = new THREE.SpriteMaterial({
						map: tex,
						transparent: true,
						opacity: baseOpacity * opacityScale,
						depthWrite: false,
						// Free rotation is fine ONLY because these sprites are square
						// (see the scale below). Rotating a stretched sprite shears it.
						rotation: rnd() * Math.PI * 2
					});
					materials.push(mat);

					const sprite = new THREE.Sprite(mat);
					const ox = cx + (rnd() - 0.5) * clusterScale;
					const oz = cz + (rnd() - 0.5) * clusterScale;
					const oy = cy + (rnd() - 0.5) * (clusterScale * 0.25);

					sprite.position.set(ox, oy, oz);
					/**
					 * SQUARE, deliberately.
					 *
					 * This was 1.3 x 1.0 while the material took a random full-circle
					 * rotation. Because sprite scale is local, that made the apparent
					 * aspect swing with the roll — 1.30 at 0 deg, 1.00 at 45, and
					 * 0.77 at 90. The same cloud texture rendered wide, round or
					 * squished depending purely on its random angle.
					 *
					 * Cloud shape comes from the texture and from overlapping
					 * billboards in a cluster, not from stretching one quad. Width
					 * variety now comes from `sprScale` alone, which is uniform.
					 */
					const sprScale = clusterScale * (0.8 + rnd() * 0.8);
					sprite.scale.set(sprScale, sprScale, 1);

					cloudGroup.add(sprite);
					sprites.push(sprite);
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

			/**
			 * Wind drift, derived from WALL CLOCK rather than accumulated.
			 *
			 * `+=` off a `performance.now()` delta makes the wind offset a
			 * function of each Pi's uptime, so even a perfectly seeded deck drifts
			 * apart across the wall as soon as one pane reboots. Assigning an
			 * absolute angle from `wallSec` is self-healing: a pane that restarts
			 * rejoins the other two mid-gust.
			 */
			const wallSec = display.view.wallSec ?? 0;

			/**
			 * The deck is WORLD-locked, not viewer-locked.
			 *
			 * It used to spin on its own axis at 0.04 rad/s -- a full revolution
			 * every 157 seconds -- which reads as a carousel, not as weather, and
			 * is unrelated to where the aircraft is pointing. Cancelling the
			 * camera bearing instead pins the deck to the ground: fly straight and
			 * it holds still, roll into a turn and it sweeps past the window. The
			 * turn is the motion; the wind is a garnish on top of it.
			 */
			const bearingRad = ((display.view.cameraBearingDeg ?? 0) * Math.PI) / 180;
			// Sign: the camera sits at +Z looking down -Z, so a group rotation of
			// +theta about +Y sweeps a straight-ahead sprite to screen LEFT --
			// which is what the window shows when the aircraft banks RIGHT and the
			// compass bearing increases. Hence +bearing, not -.
			cloudGroup.rotation.y = bearingRad + wallSec * driftSpeed * 0.0008;

			// Synchronize relative camera altitude to cloud deck
			const planeAgl = display.view.aglM ?? 4000;
			/**
			 * The camera sits exactly as far above -- or below -- the deck as the
			 * aircraft does. `1000 + delta * 1.5` put it half again too high and,
			 * because of the +1000, never let the aircraft get underneath the
			 * deck at all: there was no such thing as a cloud ceiling overhead.
			 * The 300 m guard keeps it off the deck plane, where the sprites
			 * collapse edge-on into an aliased line.
			 */
			const deltaAltM = planeAgl - cloudAltM;
			camera.position.y = Math.abs(deltaAltM) < 300 ? Math.sign(deltaAltM || 1) * 300 : deltaAltM;
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
