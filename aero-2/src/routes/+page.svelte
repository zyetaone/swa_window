<script lang="ts">
	/**
	 * The window.
	 *
	 * MapLibre is the only renderer (ADR-005, 2026-08-25). This page is
	 * deliberately thin: it owns the map handle and the frame loop, and nothing
	 * else. The motion model lives in `flight/view.ts`, the ground in
	 * `components/GroundLayers.svelte`, the knobs in `+page.ts`.
	 *
	 * Phase 1 (the Pi 5 side-by-side) has NOT run — this is a bet on look and
	 * licence, not a measured performance verdict.
	 */
	import { untrack } from 'svelte';
	import { MapLibre } from 'svelte-maplibre-gl';
	import { LngLat } from 'maplibre-gl';
	import type { Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import AtmosphereSky from '#lib/components/AtmosphereSky.svelte';
	import DebugReadout from '#lib/components/DebugReadout.svelte';
	import GroundLayers from '#lib/components/GroundLayers.svelte';
	import { windowView, type WindowView } from '#lib/flight/view.js';
	import { gameLoop } from '#lib/window/game-loop.js';
	import { resolveAtmosphere } from '#lib/world/atmosphere/rules.js';
	import { nightLighting } from '#lib/world/lighting/rules.js';
	import type { PageProps } from './$types';

	const { data: params }: PageProps = $props();

	let map = $state<MlMap | undefined>();
	// Seeded so the first paint is a real pose rather than a placeholder; the
	// frame loop replaces it immediately. `untrack` because this is a one-shot
	// seed, not a subscription to `params`.
	let view = $state<WindowView>(untrack(() => windowView(Date.now() / 1000, params)));

	const atmosphere = $derived(resolveAtmosphere(view.aglM));
	const nightFactor = $derived(nightLighting.factor(view.timeOfDay));

	$effect(() => {
		const m = map;
		if (!m) return;

		return gameLoop.subscribe(() => {
			// Absolute function of wall-clock time, never an accumulated dt: three
			// Pis booted minutes apart must agree on the aircraft for a given instant.
			const next = windowView(Date.now() / 1000, params);
			view = next;

			// MapLibre has no free camera, so the eye is placed at an ALTITUDE and
			// aimed at a ground point; MapLibre derives centre/zoom/bearing/pitch.
			// Altitude genuinely positions the camera here rather than being faked
			// through zoom.
			m.jumpTo(
				m.calculateCameraOptionsFromTo(
					new LngLat(next.lon, next.lat),
					next.mslM,
					new LngLat(next.targetLon, next.targetLat),
					params.place.groundElevationM
				)
			);
		});
	});
</script>

<svelte:head><title>aero-2</title></svelte:head>

<div class="window">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[params.place.lon, params.place.lat]}
		zoom={11}
		attributionControl={{ compact: true }}
	>
		<GroundLayers detail={params.detail} shade={params.shade} />
		<AtmosphereSky {atmosphere} />
	</MapLibre>

	{#if import.meta.env.DEV}
		<DebugReadout placeId={params.place.id} {view} {atmosphere} {nightFactor} />
	{/if}
</div>

<style>
	.window {
		position: fixed;
		inset: 0;
		background: #000;
	}
	:global(.fill) {
		position: absolute;
		inset: 0;
	}
</style>
