<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';

	let {
		lat = 25.2,
		lon = 55.3,
		zoom = 10,
		pitch = -45,
		bearing = 0,
		imageryUrl = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
		showAtmosphere = true,
	}: {
		lat?: number;
		lon?: number;
		zoom?: number;
		pitch?: number;
		bearing?: number;
		imageryUrl?: string;
		showAtmosphere?: boolean;
	} = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = null;

	export function flyTo(
		dst: { lat: number; lon: number; altitude?: number },
		_duration = 2000
	) {
		if (!map) return;
		map.flyTo({
			center: [dst.lon, dst.lat],
			zoom: dst.altitude ? Math.max(8, 16 - Math.log2(dst.altitude / 30000)) : zoom,
			pitch,
			bearing,
			duration: _duration,
		});
	}

	onMount(() => {
		map = new maplibregl.Map({
			container,
			zoom,
			center: [lon, lat],
			pitch,
			bearing,
			style: {
				version: 8,
				projection: { type: 'globe' },
				sources: {
					satellite: {
						type: 'raster',
						tiles: [imageryUrl],
						tileSize: 256,
						attribution: '© Sentinel-2 cloudless (EOX)',
					},
				},
				layers: [
					{
						id: 'Satellite',
						type: 'raster',
						source: 'satellite',
						paint: {},
					},
				],
				...(showAtmosphere
					? {
							sky: {
								'atmosphere-blend': [
									'interpolate',
									['linear'],
									['zoom'],
									0, 1,
									5, 1,
									7, 0,
								],
							},
							light: {
								anchor: 'map',
								position: [1.5, 90, 80],
							},
						}
					: {}),
			},
			attributionControl: false,
		});

		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		return () => {
			map?.remove();
			map = null;
		};
	});
</script>

<div bind:this={container} class="map-container"></div>

<style>
	.map-container {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.map-container :global(.maplibregl-ctrl-top-right) {
		top: 8px;
		right: 8px;
	}

	.map-container :global(.maplibregl-ctrl-group) {
		background: rgba(20, 20, 20, 0.8);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		overflow: hidden;
	}

	.map-container :global(.maplibregl-ctrl-group button) {
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.7);
		width: 32px;
		height: 32px;
		cursor: pointer;
	}

	.map-container :global(.maplibregl-ctrl-group button:hover) {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}
</style>