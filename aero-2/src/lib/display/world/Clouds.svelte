<script lang="ts">
	/**
	 * Clouds — High-Fidelity Photoreal 3D Atmospheric Cloud Deck.
	 *
	 * Ported from canonical Aero cluster-accumulation architecture:
	 * - Dual-tier cluster budget:
	 *   - DISTANT: 40 km - 260 km horizon weather systems with high albedo.
	 *   - CLOSE: 2 km - 35 km volumetric cumulus passing the passenger window.
	 * - Anchor-centered multi-sprite accumulation geometry with soft radial falloff.
	 * - True 3D sun-normal shading & Mie forward-scatter (pow(dot, 6) solar halo).
	 * - Circadian lighting: golden-hour amber Mie scatter, cool-blue moonlight floor,
	 *   and city sodium underglow.
	 * - Differential wind-shear & multi-frequency gust dynamics.
	 * - 100% deterministic 3-Pi panorama alignment via seeded RNG.
	 */
	import { useDisplay } from '../display.svelte.js';
	import * as THREE from 'three';
	import { mulberry32 } from '../flight/flight-path.js';

	const display = useDisplay();

	const isVisible = $derived(display.config.clouds);
	const density = $derived(display.config.cloudDensity);
	const driftSpeed = $derived(display.config.cloudSpeed);
	const cloudAltM = $derived(display.config.cloudAltitudeM);
	const opacityScale = $derived(display.config.cloudOpacity);


	const TEXTURE_URLS = ['/cloud.webp', '/cloud-dark.webp', '/cloud-smoke.webp'];

	// Scratch math vectors
	const _spriteWorld = new THREE.Vector3();
	const _viewVec = new THREE.Vector3();
	const _sunDir = new THREE.Vector3();

	/**
	 * The deck's whole life, attached to the canvas that owns it. Same shape as
	 * `Wing.svelte`, and argument-free for the same reason: `{@attach f(x)}`
	 * re-runs on any change to `x`, and this one loads textures and emits
	 * hundreds of sprites.
	 */
	function cloudScene(c: HTMLCanvasElement) {
		const renderer = new THREE.WebGLRenderer({
			canvas: c,
			alpha: true,
			antialias: true,
			powerPreference: 'high-performance'
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(c.clientWidth, c.clientHeight, false);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(50, c.clientWidth / c.clientHeight, 10, 900_000);
		camera.position.set(0, 0, 0);

		const ambient = new THREE.AmbientLight(0xffffff, 0.9);
		scene.add(ambient);

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
		const rotSpeeds: number[] = [];
		const shearFactors: number[] = [];
		/**
		 * Where each sprite starts, so the loop can SET its pose from the wall
		 * clock instead of nudging it every frame. See `gustPhase` below.
		 */
		const baseRot: number[] = [];
		const basePos: number[] = [];

		function buildCloudDeck() {
			while (cloudGroup.children.length > 0) {
				cloudGroup.remove(cloudGroup.children[0]);
			}
			materials.forEach((m) => m.dispose());
			materials.length = 0;
			sprites.length = 0;
			rotSpeeds.length = 0;
			shearFactors.length = 0;
			baseRot.length = 0;
			basePos.length = 0;

			if (textures.length === 0) return;

			// Seeded RNG from daySeed for 3-Pi multi-screen determinism
			const seed = Math.floor(display.phase * 1_000_003) + 1;
			const rng = mulberry32(seed);

			// ── 1. Distant Horizon Cloud Systems (40 km - 260 km) ──────────────────
			const distantCount = Math.round(8 + density * 16);
			for (let c = 0; c < distantCount; c++) {
				emitCluster(textures, 40_000, 220_000, 8_000, 16_000, 6, 8, 0.05, rng, 0);
			}

			// ── 2. Near & Mid-Deck Cumulus Puffs (2 km - 35 km) ─────────────────────
			const nearCount = Math.round(5 + density * 10);
			for (let c = 0; c < nearCount; c++) {
				emitCluster(textures, 2_500, 32_000, 2_000, 4_500, 4, 6, 0.12, rng, 0);
			}

			// ── 3. High-Altitude Cirrus Veil Bands (40 km - 180 km, +3500m) ─────────
			const cirrusCount = Math.round(4 + density * 6);
			for (let c = 0; c < cirrusCount; c++) {
				emitCluster(
					[textures[2] || textures[0]],
					40_000,
					140_000,
					12_000,
					22_000,
					3,
					5,
					0.2,
					rng,
					3500
				);
			}
		}

		function emitCluster(
			texList: THREE.Texture[],
			radiusMin: number,
			radiusSpan: number,
			scaleMin: number,
			scaleSpan: number,
			spriteMin: number,
			spriteSpan: number,
			lonelyChance: number,
			rand: () => number,
			altOffset: number = 0
		) {
			const angle = rand() * Math.PI * 2;
			const dist = radiusMin + Math.sqrt(rand()) * radiusSpan;
			const cx = Math.cos(angle) * dist;
			const cz = Math.sin(angle) * dist;
			const ch = altOffset + (rand() - 0.5) * 800;

			const isLonely = rand() < lonelyChance;
			const spriteCount = isLonely ? 1 : spriteMin + Math.floor(rand() * spriteSpan);
			const baseScale = scaleMin + rand() * scaleSpan;
			const clusterShear = (rand() - 0.5) * 0.25;

			for (let i = 0; i < spriteCount; i++) {
				// Anchor sprite at cluster center; surrounding puffs spread radially
				let ox = cx;
				let oy = ch;
				let oz = cz;

				if (i > 0) {
					const theta = rand() * Math.PI * 2;
					const r = (0.2 + rand() * 0.8) * baseScale * 1.6;
					ox += Math.cos(theta) * r;
					oz += Math.sin(theta) * r;
					oy += (rand() - 0.5) * (baseScale * 0.35);
				}

				const sprScale = baseScale * (i === 0 ? 1.25 : 0.85 + rand() * 0.55);
				const texIdx = rand() < 0.7 ? 0 : 1 + Math.floor(rand() * (texList.length - 1));
				const tex = texList[texIdx];

				// Vertical underside gradient shading
				const yNorm = (oy - ch + baseScale * 0.1) / (baseScale * 0.2);
				const yClamp = Math.max(0, Math.min(1, yNorm));
				const ySoft = yClamp * yClamp * (3 - 2 * yClamp);
				const baseBrightness = 0.65 + ySoft * 0.15;
				const baseOpacity = 0.22 + rand() * 0.26;

				const mat = new THREE.SpriteMaterial({
					map: tex,
					transparent: true,
					opacity: baseOpacity * opacityScale,
					depthWrite: false,
					color: new THREE.Color(baseBrightness, baseBrightness, baseBrightness),
					rotation: rand() * Math.PI * 2
				});

				// Store pseudo-normal for sun-side 3D shading
				const dx = ox - cx;
				const dy = oy - ch;
				const dz = oz - cz;
				const mag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

				mat.userData = {
					baseBrightness,
					baseOpacity,
					normX: dx / mag,
					normY: dy / mag,
					normZ: dz / mag
				};
				materials.push(mat);

				const sprite = new THREE.Sprite(mat);
				sprite.position.set(ox, oy, oz);
				sprite.scale.set(sprScale, sprScale, 1);

				cloudGroup.add(sprite);
				sprites.push(sprite);
				rotSpeeds.push((rand() - 0.5) * 0.05);
				shearFactors.push(clusterShear);
				baseRot.push(mat.rotation);
				basePos.push(ox, oz);
			}
		}

		let raf: number;

		const renderLoop = () => {
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

			// Synchronize relative camera altitude, pitch and banking tilt
			const planeAgl = display.view.aglM;
			const deltaAltM = planeAgl - cloudAltM;
			camera.position.set(
				0,
				Math.abs(deltaAltM) < 150 ? Math.sign(deltaAltM || 1) * 150 : deltaAltM,
				0
			);

			const pitchDeg = display.config.pitchDeg ?? -10;
			const bankDeg = display.view.bankDeg;
			const effectivePitchRad = ((pitchDeg + bankDeg * 0.12) * Math.PI) / 180;
			const bankRad = (bankDeg * Math.PI) / 180;

			camera.rotation.order = 'YXZ';
			camera.rotation.x = effectivePitchRad;
			camera.rotation.y = 0;
			camera.rotation.z = -bankRad;

			// World-locked compass orientation + continuous wind drift & gust modulation
			const bearingRad = (display.view.cameraBearingDeg * Math.PI) / 180;
			const wallSec = display.view.wallSec;

			/**
			 * Gusting wind, as a POSITION on the clock rather than a speed to
			 * accumulate.
			 *
			 * The deck used to integrate: `windT += dt` off `performance.now()`,
			 * a gust factor computed from `windT`, and then `+=` again onto every
			 * sprite's spin and position. Three per-pane accumulators, in a deck
			 * whose own docstring claims 3-Pi determinism. Each pane dropped
			 * frames its own way and `Math.min(0.1, dt)` discarded the overflow,
			 * so the wind phase drifted apart with uptime -- the same shape that
			 * split the director before it moved to a wall-clock slot, and a
			 * blocker on the wall in v1. Panes agree at a glance and disagree
			 * after an hour.
			 *
			 * This is the same gust, expressed as an absolute phase: it advances
			 * at roughly 1 per second and breathes about that, so `d/dt` looks
			 * like the old `gust` factor without anything being remembered
			 * between frames. Every pane computes the same value for the same
			 * second, and a pane that reboots rejoins the weather mid-gust.
			 */
			const gustPhase = wallSec + 3.6 * Math.sin(wallSec * 0.137) * Math.cos(wallSec * 0.273);
			const driftPhase = gustPhase * driftSpeed * 0.008;
			cloudGroup.rotation.y = bearingRad + wallSec * driftSpeed * 0.0006;

			// ── Per-Sprite 3D Solar Lighting & Mie Forward-Scatter ─────────────────
			const sunElev = display.sun.elevationDeg;
			const sunAzimuth = display.sun.azimuthDeg;
			const night = display.night;
			const dayFactor = Math.max(0, 1 - night);

			// Spherical sun direction vector in Three.js coordinates
			const sunElevRad = (sunElev * Math.PI) / 180;
			const sunAzRad = (sunAzimuth * Math.PI) / 180;
			_sunDir
				.set(
					Math.sin(sunAzRad) * Math.cos(sunElevRad),
					Math.sin(sunElevRad),
					-Math.cos(sunAzRad) * Math.cos(sunElevRad)
				)
				.normalize();

			const mieGain = dayFactor * (sunElev > 0 && sunElev < 25 ? 1.4 : 0.6);
			const liveSunBoost = Math.max(0, Math.sin(sunElevRad)) * dayFactor * 0.6;
			const nightDark = 1 - night * 0.78;
			const coolG = 1 - night * 0.22;
			const coolB = 1 - night * 0.08;
			const moonLit = night * 0.08;

			for (let i = 0; i < sprites.length; i++) {
				const s = sprites[i];
				const mat = materials[i];
				const baseB = (mat.userData.baseBrightness ?? 0.75) as number;
				const baseO = (mat.userData.baseOpacity ?? 0.3) as number;

				// Spin & shear, both SET from the clock rather than nudged.
				mat.rotation = (baseRot[i] ?? 0) + rotSpeeds[i] * gustPhase;
				const shear = shearFactors[i] ?? 0;
				if (shear !== 0) {
					const angle = driftPhase * shear;
					const cs = Math.cos(angle);
					const sn = Math.sin(angle);
					const px = basePos[i * 2];
					const pz = basePos[i * 2 + 1];
					s.position.x = px * cs - pz * sn;
					s.position.z = px * sn + pz * cs;
				}

				// Forward Mie scatter
				_spriteWorld.copy(s.position).applyMatrix4(cloudGroup.matrixWorld);
				_viewVec.subVectors(_spriteWorld, camera.position).normalize();
				const dot = Math.max(0, _viewVec.dot(_sunDir));
				const d2 = dot * dot;
				const d6 = d2 * d2 * d2;
				const mie = d6 * mieGain;

				// 3D Sun-normal face lighting
				const nx = mat.userData.normX as number;
				const ny = mat.userData.normY as number;
				const nz = mat.userData.normZ as number;
				const sunDot = nx * _sunDir.x + ny * _sunDir.y + nz * _sunDir.z;
				const sunSide = Math.max(0, sunDot) * dayFactor * 0.35;

				// Per-channel lit composition (golden hour amber boost -> cool moonlit Rayleigh)
				const litR = baseB * (1 + liveSunBoost * 0.85 + mie * 1.5 + sunSide * 1.1);
				const litG = baseB * (1 + liveSunBoost * 0.85 + mie * 1.0 + sunSide * 1.0);
				const litB = baseB * (1 + liveSunBoost * 0.85 + mie * 0.45 + sunSide * 0.85);

				mat.color.setRGB(
					litR * nightDark + moonLit * 0.82,
					litG * nightDark * coolG + moonLit * 1.0,
					litB * nightDark * coolB + moonLit * 1.25
				);
				mat.opacity = baseO * opacityScale;
			}

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
		}
</script>

{#if isVisible}
	<canvas {@attach cloudScene} class="cabin-clouds-canvas" aria-hidden="true"></canvas>
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
