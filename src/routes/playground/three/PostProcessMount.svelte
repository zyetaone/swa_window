<script lang="ts">
	/**
	 * PostProcessMount — overlays a Three.js EffectComposer on top of
	 * MapLibre.
	 *
	 * Mount approach: Option B (separate Three.js canvas absolutely
	 * positioned above MapLibre). We considered Option A (shared GL
	 * context via maplibre CustomLayer) — cleaner for per-layer 3D
	 * content but unsuitable for post-processing the COMPOSITED frame
	 * because MapLibre renders to the default framebuffer without
	 * exposing its backbuffer texture. Option B does one
	 * canvas-to-canvas draw per frame (≪1% CPU at 1440×900), reliable
	 * across WebGL versions, and keeps this concern independent of
	 * MapLibre internals.
	 *
	 * Lifecycle:
	 *   - Mount:    spin up WebGLRenderer + EffectComposer on our canvas
	 *   - Each RAF: syncInput(MapLibre canvas) → setUniforms → render()
	 *   - Resize:   ResizeObserver → composer.setSize
	 *   - Unmount:  dispose renderer + passes + textures
	 *
	 * The overlay canvas uses `pointer-events: none` so MapLibre stays
	 * fully interactive underneath.
	 */

	import { onMount, onDestroy } from 'svelte';
	import type maplibregl from 'maplibre-gl';
	import { createPostComposer, dawnDuskFrom, type PostComposerHandle } from './post-composer.svelte';
	import type { WaterUniforms } from './passes/WaterPass';

	let {
		map,
		nightFactor = 0,
		lightIntensity = 1,
		water = undefined,
	}: {
		map: maplibregl.Map | undefined;
		nightFactor?: number;
		lightIntensity?: number;
		/** Live water uniforms — palette-driven. Omit to skip water effect. */
		water?: WaterUniforms | undefined;
	} = $props();

	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
	let handle: PostComposerHandle | undefined;
	let rafId = 0;
	let resizeObs: ResizeObserver | undefined;

	const dawnDusk = $derived(dawnDuskFrom(nightFactor));

	function raf(): void {
		if (!handle || !map) {
			rafId = requestAnimationFrame(raf);
			return;
		}
		const ml = map.getCanvas?.();
		if (ml && ml.width > 0 && ml.height > 0) {
			handle.syncInput(ml);
			handle.setUniforms({
				nightFactor,
				dawnDuskFactor: dawnDusk,
				lightIntensity,
				water,
			});
			handle.render();
		}
		rafId = requestAnimationFrame(raf);
	}

	onMount(() => {
		if (!canvasEl) return;
		handle = createPostComposer(canvasEl);

		// Sync size to the MapLibre canvas parent.
		const target = canvasEl.parentElement;
		if (target && 'ResizeObserver' in window) {
			resizeObs = new ResizeObserver((entries) => {
				const r = entries[0]?.contentRect;
				if (!r || !handle) return;
				canvasEl!.width = Math.max(1, Math.floor(r.width));
				canvasEl!.height = Math.max(1, Math.floor(r.height));
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
	bind:this={canvasEl}
	class="postprocess-overlay"
	aria-hidden="true"
></canvas>

<style>
	.postprocess-overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		/* Screen-blended so the post-process sits ON the MapLibre frame
		   rather than occluding it. Since the post-process is a graded
		   version of MapLibre's OWN pixels, normal blending is correct —
		   but `opacity` below lets the grade fade in with nightFactor
		   without a JS re-render. */
		z-index: 2;
		mix-blend-mode: normal;
	}
</style>
