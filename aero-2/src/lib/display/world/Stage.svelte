<script lang="ts">
	/**
	 * Stage — the MapLibre viewport and the flight loop that drives it.
	 *
	 * Everything visible inside it is a child component: Ground (colour),
	 * Terrain (shape), Sky (air and haze), LookControls (aiming). This file owns
	 * exactly one thing — where the camera is, every frame.
	 *
	 * Uses 3D spherical Earth projection ({ type: 'globe' }) to render authentic
	 * horizon curvature and background space sky at cruising altitude.
	 */
	import { MapLibre } from 'svelte-maplibre-gl';
	import { LngLat, type Map as MlMap } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { useDisplay } from '../display.svelte.js';
	import Ground from './Ground.svelte';
	import Terrain from './Terrain.svelte';
	import Sky from './Sky.svelte';
	import LookControls from '../flight/LookControls.svelte';

	const BLANK_STYLE = {
		version: 8 as const,
		projection: { type: 'globe' as const },
		sources: {},
		layers: []
	};

	const display = useDisplay();

	let map = $state<MlMap | undefined>();

	/**
	 * Fly the plane & initialize 3D spherical globe projection.
	 */
	$effect(() => {
		const m = map;
		if (!m) return;

		// Configure 3D Globe Projection if supported by MapLibre
		if (
			typeof (m as unknown as { setProjection?: (p: { type: string }) => void }).setProjection ===
			'function'
		) {
			(m as unknown as { setProjection: (p: { type: string }) => void }).setProjection({
				type: 'globe'
			});
		}

		let raf: number;
		const loop = () => {
			const v = display.advanceTo(Date.now() / 1000);
			m.jumpTo(
				m.calculateCameraOptionsFromTo(
					new LngLat(v.lon, v.lat),
					v.aglM + display.config.place.groundElevationM,
					new LngLat(v.targetLon, v.targetLat),
					display.config.place.groundElevationM
				)
			);
			raf = requestAnimationFrame(loop);
		};

		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="world-stage">
	<MapLibre
		bind:map
		class="fill"
		style={BLANK_STYLE}
		center={[display.config.place.lon, display.config.place.lat]}
		zoom={9}
		anisotropicFilterPitch={20}
		attributionControl={{ compact: true }}
	>
		<Ground />
		<Terrain />
		<Sky />
		<LookControls />
	</MapLibre>
</div>

<style>
	.world-stage {
		position: absolute;
		inset: 0;
	}
	:global(.fill) {
		position: absolute;
		inset: 0;
	}
</style>
