<script lang="ts">
	/**
	 * Wing — High-Fidelity 3D Boeing 737 aircraft wing rendered in the passenger window.
	 *
	 * Uses Three.js WebGL with upward dihedral sweep, wingtip navigation light (starboard green),
	 * double-pulse strobe beacon, and dynamic specular lighting reflecting solar time.
	 * Responds dynamically to airframe banking, solar lighting transitions, and operator alignment knobs.
	 */
	import { useDisplay } from '../display.svelte.js';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

	const display = useDisplay();

	const isVisible = $derived(display.config.wing);
	const scale = $derived(display.config.wingScale ?? 0.65);
	const offsetX = $derived(display.config.wingOffsetX ?? 0);
	const offsetY = $derived(display.config.wingOffsetY ?? 0);
	const pitchOffset = $derived(display.config.wingPitchDeg ?? 0);
	const yawOffset = $derived(display.config.wingYawDeg ?? 0);
	const rollFactor = $derived(display.config.wingRollFactor ?? 1.0);

	// ── 3D Canvas & Three.js Scene Lifecycle ──────────────────────────────────
	let canvas = $state<HTMLCanvasElement | undefined>();

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
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;

		const scene = new THREE.Scene();
		// Expanded frustum and depth bounds: zero edge clipping across all aspect ratios
		const camera = new THREE.PerspectiveCamera(52, c.clientWidth / c.clientHeight, 0.001, 1000);
		camera.position.set(0, 0, 6.2);

		/**
		 * Solar lighting, actually solar.
		 *
		 * These two intensities were constants -- 0.9 and 2.2 -- while this
		 * file's own docstring promised "dynamic specular lighting reflecting
		 * solar time". At `?preset=gulf-midnight` the result was a wing lit like
		 * noon, pasted on a starfield over a black Persian Gulf: the single most
		 * obviously wrong thing in the night window.
		 *
		 * Set once here, driven per frame in the render loop below off
		 * `display.night`, which is the same 0..1 the ground grade and the
		 * starfield already ramp on, so the wing goes out with the sky rather
		 * than on a schedule of its own.
		 */
		const ambient = new THREE.AmbientLight(0xffffff, 0.9);
		scene.add(ambient);

		const sunKey = new THREE.DirectionalLight(0xffeedd, 2.2);
		sunKey.position.set(6, 9, 5);
		scene.add(sunKey);

		/** Warm noon key vs. cold moonlight, and the ambient that survives dusk. */
		const SUN_COLOR = new THREE.Color(0xffeedd);
		const MOON_COLOR = new THREE.Color(0x9fb6da);

		const wingHolder = new THREE.Group();
		// Base positioning: Root in lower right, wing sweeping into camera depth
		wingHolder.position.set(1.1, -1.1, 0);
		scene.add(wingHolder);

		// Wingtip Strobe & Nav Light in 3D
		const strobeLight = new THREE.PointLight(0xffffff, 0, 15);
		strobeLight.position.set(-2.6, 0.85, -1.6);
		wingHolder.add(strobeLight);

		const navLight = new THREE.PointLight(0x22c55e, 1.5, 4); // Green starboard nav light
		navLight.position.set(-2.6, 0.85, -1.6);
		wingHolder.add(navLight);

		let wingMesh: THREE.Object3D | null = null;
		const loader = new GLTFLoader();

		loader.load(
			'/models/wing.glb',
			(gltf) => {
				wingMesh = gltf.scene;
				// Canonical forward flight orientation & aerodynamic chord facing motion
				wingMesh.rotation.set(0.02, 1.68, 0.18);
				wingMesh.scale.set(1.11, 1.11, -1.11);
				wingMesh.traverse((child) => {
					if (child instanceof THREE.Mesh && child.material) {
						child.material.side = THREE.DoubleSide;
					}
				});
				wingHolder.add(wingMesh);
			},
			undefined,
			(err) => {
				console.warn('[Wing] 3D wing.glb load warning:', err);
			}
		);

		let raf: number;

		const renderLoop = (now: number) => {
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
			 * Take the sun off the wing as the sky loses it.
			 *
			 * The key light does not fade to nothing: a wing at cruise altitude
			 * still catches moon and skyglow, and a truly black wing reads as a
			 * missing object rather than a dark one. It fades to a tenth, and
			 * turns cold on the way -- the colour shift is what sells night more
			 * than the level does.
			 */
			const night = display.night;
			ambient.intensity = 0.9 - night * 0.74;
			sunKey.intensity = 2.2 * (1 - night * 0.9);
			sunKey.color.copy(SUN_COLOR).lerp(MOON_COLOR, night);

			// Strobe flash double-pulse pattern (every 1.8 seconds)
			const strobeCycle = (now % 1800) / 1800;
			if ((strobeCycle > 0.9 && strobeCycle < 0.93) || (strobeCycle > 0.96 && strobeCycle < 0.99)) {
				strobeLight.intensity = 8.0;
			} else {
				strobeLight.intensity = 0.0;
			}

			if (wingMesh) {
				const sweepRad = 1.68 + (yawOffset * Math.PI) / 180;
				wingMesh.rotation.set(0.02, sweepRad, 0.18);
			}

			if (wingHolder) {
				const bank = display.view.bankDeg ?? 0;
				const screenSign = (display.config.direction ?? 1) < 0 ? -1 : 1;
				// In airframe-relative cabin space, the wing is rigidly mounted to the fuselage outside the window.
				// Aeroelastic wingtip flex: under banking lift loads, the wing flexes subtly (0.04 factor).
				const aeroFlexDeg = bank * 0.04 * rollFactor;
				const currentPitchRad = ((pitchOffset + aeroFlexDeg) * Math.PI) / 180;

				// Rigid cabin airframe lock with aeroelastic lift flex
				wingHolder.rotation.z = -currentPitchRad * screenSign;
				wingHolder.scale.set(scale * screenSign, scale, scale);

				// Locked 3D translation inside cabin reference frame with high-frequency aero-flutter
				const flutter = (display.view.turbulence?.wingFlutterPx ?? 0) * 0.0015;
				wingHolder.position.set(
					1.1 * screenSign + offsetX * 0.005 * screenSign,
					-1.1 - offsetY * 0.005 + flutter,
					0
				);

				// Aviation Standard: Green for Starboard (Right, screenSign > 0), Red for Port (Left, screenSign < 0)
				navLight.color.setHex(screenSign > 0 ? 0x22c55e : 0xef4444);
			}

			renderer.render(scene, camera);
			raf = requestAnimationFrame(renderLoop);
		};

		raf = requestAnimationFrame(renderLoop);

		return () => {
			cancelAnimationFrame(raf);
			renderer.dispose();
			scene.clear();
		};
	});
</script>

{#if isVisible}
	<!-- Pure 3D WebGL Canvas Layer (Unclipped 100% Viewport Bounds) -->
	<canvas bind:this={canvas} class="cabin-wing-canvas" aria-hidden="true"></canvas>
{/if}

<style>
	.cabin-wing-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 5;
	}
</style>
