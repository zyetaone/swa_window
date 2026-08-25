<script lang="ts">
	/**
	 * Wing — aircraft wing rendered in the passenger window.
	 *
	 * Supports BOTH:
	 * 1. 3D Real Boeing 737 Model (wing.glb) with upward dihedral inclination,
	 *    wingtip navigation lights, and strobe beacon on a lightweight Three.js <canvas bind:this={canvas}>.
	 * 2. 2D Vector Silhouette SVG with inclined profile and navigation lighting.
	 *
	 * Responds dynamically to airframe banking, solar lighting transitions, and operator alignment knobs.
	 */
	import { useDisplay } from '../display.svelte.js';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

	interface Props {
		visible?: boolean;
	}

	let { visible = true }: Props = $props();

	const display = useDisplay();

	const isVisible = $derived(visible && display.config.wing);
	const mode = $derived(display.config.wingMode ?? '3d');
	const scale = $derived(display.config.wingScale ?? 0.65);
	const offsetX = $derived(display.config.wingOffsetX ?? -405);
	const offsetY = $derived(display.config.wingOffsetY ?? -20);
	const pitchOffset = $derived(display.config.wingPitchDeg ?? 0);
	const rollFactor = $derived(display.config.wingRollFactor ?? 1.0);

	/** 2D SVG Roll calculation */
	const svgRoll = $derived((display.view.bankDeg ?? 0) * 0.55 * rollFactor + pitchOffset);

	// ── 3D Canvas & Three.js Scene Lifecycle ──────────────────────────────────
	let canvas = $state<HTMLCanvasElement | undefined>();
	let modelLoaded = $state(false);

	$effect(() => {
		if (!canvas || mode !== '3d' || !isVisible) return;

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

		// Dynamic Solar Lighting
		const ambient = new THREE.AmbientLight(0xffffff, 0.9);
		scene.add(ambient);

		const sunKey = new THREE.DirectionalLight(0xffeedd, 2.2);
		sunKey.position.set(6, 9, 5);
		scene.add(sunKey);

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
				modelLoaded = true;
			},
			undefined,
			(err) => {
				console.warn('[Wing] 3D wing.glb failed to load, falling back to 2D:', err);
				modelLoaded = false;
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

			// Strobe flash double-pulse pattern (every 1.8 seconds)
			const strobeCycle = (now % 1800) / 1800;
			if ((strobeCycle > 0.9 && strobeCycle < 0.93) || (strobeCycle > 0.96 && strobeCycle < 0.99)) {
				strobeLight.intensity = 8.0;
			} else {
				strobeLight.intensity = 0.0;
			}

			if (wingHolder) {
				const bank = display.view.bankDeg ?? 0;
				const dir = display.config.direction ?? 1;
				const currentRollRad = ((bank * 0.55 * rollFactor + pitchOffset) * Math.PI) / 180;
				wingHolder.rotation.z = -currentRollRad;
				wingHolder.scale.set(scale * dir, scale, scale);
				// Unclipped 3D translation inside WebGL coordinates with direction awareness
				wingHolder.position.set(1.1 * dir + offsetX * 0.005, -1.1 - offsetY * 0.005, 0);
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
	{@const dir = display.config.direction ?? 1}
	{#if mode === '3d'}
		<!-- 3D WebGL Canvas Layer (Unclipped 100% Viewport Bounds) -->
		<canvas bind:this={canvas} class="cabin-wing-canvas" aria-hidden="true"></canvas>
	{/if}

	{#if mode === '2d' || (mode === '3d' && !modelLoaded)}
		<!-- 2D Vector Silhouette Fallback Layer -->
		<div
			class="cabin-wing-2d"
			style:rotate="{svgRoll}deg"
			style:scale="{scale * dir}
			{scale}"
			style:translate="{offsetX * dir}px {offsetY}px"
			aria-hidden="true"
		>
			<svg class="wing-svg" viewBox="0 0 1000 600" preserveAspectRatio="none">
				<defs>
					<linearGradient id="wingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" stop-color="#334155" stop-opacity="0.95" />
						<stop offset="55%" stop-color="#1e293b" stop-opacity="0.98" />
						<stop offset="100%" stop-color="#0f172a" stop-opacity="1" />
					</linearGradient>
					<linearGradient id="edgeHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
						<stop offset="0%" stop-color="#ffffff" stop-opacity="0.35" />
						<stop offset="100%" stop-color="#ffffff" stop-opacity="0.05" />
					</linearGradient>
				</defs>

				<!-- Inclined wing body -->
				<path
					d="M 1000,500 L 260,330 Q 210,310 180,260 L 160,280 L 1000,600 Z"
					fill="url(#wingGrad)"
				/>
				<!-- Leading edge highlight -->
				<path
					d="M 1000,500 L 260,330 Q 210,310 180,260"
					fill="none"
					stroke="url(#edgeHighlight)"
					stroke-width="3.5"
				/>
				<!-- Green Navigation Light -->
				<circle cx="185" cy="265" r="3.5" fill="#22c55e" class="nav-light" />
				<!-- White Wingtip Strobe Light -->
				<circle cx="175" cy="275" r="4.5" fill="#ffffff" class="strobe" />
			</svg>
		</div>
	{/if}
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

	.cabin-wing-2d {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
		z-index: 5;
		transform-origin: 100% 65%;
		will-change: rotate, transform;
		transition: scale 0.1s ease-out;
	}

	.wing-svg {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 68%;
		height: 52%;
	}

	.nav-light {
		filter: drop-shadow(0 0 6px #22c55e);
	}

	.strobe {
		animation: strobe-pulse 1.8s infinite ease-in-out;
		filter: drop-shadow(0 0 8px #ffffff);
	}

	@keyframes strobe-pulse {
		0%,
		88%,
		100% {
			opacity: 0.15;
			transform-origin: 175px 275px;
			transform: scale(1);
		}
		91% {
			opacity: 1;
			transform-origin: 175px 275px;
			transform: scale(2);
		}
		94% {
			opacity: 0.2;
			transform-origin: 175px 275px;
			transform: scale(1);
		}
		97% {
			opacity: 1;
			transform-origin: 175px 275px;
			transform: scale(2);
		}
	}
</style>
