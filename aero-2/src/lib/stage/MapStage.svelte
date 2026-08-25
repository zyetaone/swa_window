<script lang="ts">
	/**
	 * MapStage — declarative MapLibre viewport driven by AeroWindow flight camera.
	 */
	import type { Snippet } from 'svelte';
	import { MapLibre } from 'svelte-maplibre-gl';
	import { LngLat } from 'maplibre-gl';
	import type { Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { useAeroWindow } from '#lib/flight/aero-window.svelte.js';
	import { gameLoop } from '#lib/flight/game-loop.js';

	interface Props {
		children?: Snippet;
	}

	const { children }: Props = $props();
	const windowState = useAeroWindow();

	let map = $state<MlMap | undefined>();

	$effect(() => {
		const m = map;
		if (!m) return;

		return gameLoop.subscribe((nowSec) => {
			const next = windowState.tick(nowSec);

			m.jumpTo(
				m.calculateCameraOptionsFromTo(
					new LngLat(next.lon, next.lat),
					next.mslM,
					new LngLat(next.targetLon, next.targetLat),
					windowState.params.place.groundElevationM
				)
			);
		});
	});
</script>

<div class="map-stage">
	<MapLibre
		bind:map
		class="fill"
		style={{ version: 8, sources: {}, layers: [] }}
		center={[windowState.params.place.lon, windowState.params.place.lat]}
		zoom={11}
		anisotropicFilterPitch={20}
		attributionControl={{ compact: true }}
	>
		{#if children}
			{@render children()}
		{/if}
	</MapLibre>
</div>

<style>
	.map-stage {
		position: absolute;
		inset: 0;
	}
	:global(.fill) {
		position: absolute;
		inset: 0;
	}
</style>
