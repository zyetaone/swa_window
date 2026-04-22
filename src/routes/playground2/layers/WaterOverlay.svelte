<script lang="ts">
	/**
	 * WaterOverlay — per-cell water post-process in /playground2.
	 *
	 * Mounts a transparent Three.js overlay canvas that reads pixels from
	 * the provided MapLibre canvas each frame, runs the chroma-key water
	 * shader (horizon gate + 3-scale normals + shore ripple), and draws
	 * the result on top. Non-water pixels stay transparent so the
	 * underlying MapLibre globe shows through untouched.
	 *
	 * Consumer pattern:
	 *   <div class="cell" style="position: relative">
	 *     <MapLibreCell />                                    <!-- z-base -->
	 *     <WaterOverlay mapCanvas={mlCanvas} />               <!-- overlay -->
	 *   </div>
	 *
	 * The caller is responsible for acquiring the MapLibre canvas and
	 * passing it in (MapLibreCell keeps it private — we intentionally
	 * don't modify it per the task rules). In practice /playground2's
	 * SceneCell will plumb this together in a later commit.
	 */
	import { onMount, onDestroy } from 'svelte';
	import * as THREE from 'three';
	import { sceneState } from '../lib/scene-state.svelte';
	import { solarPosition } from '../lib/sun.svelte';
	import {
		createWaterOverlay,
		dawnDuskFrom,
		type WaterOverlayHandle,
	} from './water-overlay';

	let {
		mapCanvas,
		waterBase = [0.15, 0.32, 0.45] as THREE.Vector3Tuple,
		intensity = 0.5,
	}: {
		/**
		 * The MapLibre (or other source) canvas we read from. May be
		 * undefined during initial mount — we just no-op until it shows
		 * up, so callers can bind this reactively.
		 */
		mapCanvas: HTMLCanvasElement | undefined;
		/**
		 * Palette water color to chroma-key against. Defaults to the
		 * prod-ish blue — override when MapLibre's water fill color is
		 * known exactly.
		 */
		waterBase?: THREE.Vector3Tuple;
		/** 0 disables, 1 full. Lets hosts fade the effect in. */
		intensity?: number;
	} = $props();

	let overlayCanvas = $state<HTMLCanvasElement | undefined>(undefined);
	let handle: WaterOverlayHandle | undefined;
	let rafId = 0;
	let resizeObs: ResizeObserver | undefined;
	const startTs = performance.now();

	// Night factor from time of day — simple day/night gate. Full dark
	// below −6° sun altitude, full day above +6°, smooth in between.
	// This is /playground2's minimal sky driver; if a richer sky-phase
	// lands later, swap to it.
	function computeNightFactor(timeOfDay: number, latDeg: number): number {
		const { elevationDeg } = solarPosition(timeOfDay, latDeg);
		return 1 - Math.max(0, Math.min(1, (elevationDeg + 6) / 12));
	}

	/**
	 * Compute uniforms from scene state + sun math. Kept as a plain
	 * function (not a $derived) so it re-runs every frame — scrolling
	 * normals need u_time updated per-frame regardless of state changes.
	 */
	function buildUniforms() {
		const now = (performance.now() - startTs) / 1000;
		const nightFactor = computeNightFactor(sceneState.timeOfDay, sceneState.lat);
		const dawnDuskFactor = dawnDuskFrom(nightFactor);

		// Screen-space sun direction: x horizontal (−1 left .. +1 right),
		// y vertical, z altitude above horizon. Elevation drives z; hour
		// of day drives x. This is a coarse approximation — fine for
		// screen-space specular placement.
		const { elevationDeg } = solarPosition(
			sceneState.timeOfDay,
			sceneState.lat,
		);
		const sunAlt = Math.max(0, Math.sin((elevationDeg * Math.PI) / 180));
		// Hour-angle-based x placement: noon = center, 6h = left, 18h = right.
		const sunX = Math.sin(((sceneState.timeOfDay - 12) / 12) * Math.PI);
		const sunY = 1 - sunAlt; // higher sun sits lower in the frame
		const sunLen = Math.hypot(sunX, sunY, sunAlt) || 1;
		const sunDirScreen: THREE.Vector3Tuple = [
			sunX / sunLen,
			sunY / sunLen,
			sunAlt / sunLen,
		];

		// Sun color shifts warm at dawn/dusk. Neutral at noon, amber near
		// horizon — crude but gets the shader's specular color right.
		const warmth = dawnDuskFactor; // 0..1
		const sunColor: THREE.Vector3Tuple = [
			1.0,
			0.95 - warmth * 0.25,
			0.85 - warmth * 0.45,
		];

		// Sky reflection — tinted by night factor.
		const skyR = 0.55 - nightFactor * 0.45;
		const skyG = 0.7 - nightFactor * 0.55;
		const skyB = 0.9 - nightFactor * 0.6;
		const skyReflection: THREE.Vector3Tuple = [skyR, skyG, skyB];

		return {
			nightFactor,
			dawnDuskFactor,
			waterBase,
			sunDirScreen,
			sunColor,
			skyReflection,
			waterIntensity: intensity,
			time: now,
		};
	}

	function raf(): void {
		if (!handle) {
			rafId = requestAnimationFrame(raf);
			return;
		}
		if (mapCanvas && mapCanvas.width > 0 && mapCanvas.height > 0) {
			handle.syncInput(mapCanvas);
			handle.setUniforms(buildUniforms());
			handle.render();
		}
		rafId = requestAnimationFrame(raf);
	}

	onMount(() => {
		if (!overlayCanvas) return;
		handle = createWaterOverlay(overlayCanvas);

		const target = overlayCanvas.parentElement;
		if (target && 'ResizeObserver' in window) {
			resizeObs = new ResizeObserver((entries) => {
				const r = entries[0]?.contentRect;
				if (!r || !handle || !overlayCanvas) return;
				overlayCanvas.width = Math.max(1, Math.floor(r.width));
				overlayCanvas.height = Math.max(1, Math.floor(r.height));
				handle.resize(r.width, r.height);
			});
			resizeObs.observe(target);
		}

		rafId = requestAnimationFrame(raf);
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		resizeObs?.disconnect();
		handle?.dispose();
		handle = undefined;
	});
</script>

<canvas
	bind:this={overlayCanvas}
	class="water-overlay"
	aria-hidden="true"
></canvas>

<style>
	.water-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		/* Sits above the MapLibre canvas; transparent where the water
		   shader's mask is 0, opaque where it's painting water. */
		z-index: 2;
	}
</style>
