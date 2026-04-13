<script lang="ts">
	import { onMount } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import { PMTiles } from 'pmtiles';

	let {
		lat = 25.2,
		lon = 55.3,
		zoom = 10,
		pitch = -45,
		bearing = 0,
		imageryUrl = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
		pmtilesUrl = '',
		terrainUrl = '',
		terrainPmtilesUrl = '',
		showAtmosphere = true,
	}: {
		lat?: number;
		lon?: number;
		zoom?: number;
		pitch?: number;
		bearing?: number;
		imageryUrl?: string;
		pmtilesUrl?: string;
		terrainUrl?: string;
		terrainPmtilesUrl?: string;
		showAtmosphere?: boolean;
	} = $props();

	let container: HTMLDivElement;
	let map: maplibregl.Map | null = null;

	function swapSource() {
		if (!map) return;
		try {
			if (map.getLayer('Satellite')) map.removeLayer('Satellite');
			if (map.getSource('satellite')) map.removeSource('satellite');
			map.addSource('satellite', {
				type: 'raster',
				tiles: pmtilesUrl
					? [`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`]
					: [imageryUrl],
				tileSize: 256,
				attribution: pmtilesUrl
					? '© ESRI World Imagery (cached)'
					: '© Sentinel-2 cloudless (EOX)',
			});
			map.addLayer({ id: 'Satellite', type: 'raster', source: 'satellite' });
		} catch (e) { console.warn('[MapLibreGlobe] source swap failed:', e); }
	}

	$effect(() => {
		if (!map) return;
		if (!map.isStyleLoaded()) {
			map.once('styledata', () => swapSource());
			return;
		}
		swapSource();
	});

	onMount(() => {
		if (pmtilesUrl) {
			maplibregl.addProtocol('pmtiles', async (params) => {
				const url = params.url;
				const match = url.match(/^pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/);
				if (!match) throw new Error('Invalid PMTiles URL');
				const archive = new PMTiles(match[1]);
				const z = parseInt(match[2]);
				const x = parseInt(match[3]);
				const y = parseInt(match[4]);
				const res = await archive.getZxy(z, x, y);
				if (!res) return { data: null };
				return { data: res.data };
			});
		}

		const style: maplibregl.StyleSpecification = {
			version: 8,
			projection: { type: 'globe' as const },
			sources: {
				satellite: {
					type: 'raster' as const,
					tiles: pmtilesUrl
						? [`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`]
						: [imageryUrl],
					tileSize: 256,
					attribution: pmtilesUrl
						? '© ESRI World Imagery (cached)'
						: '© Sentinel-2 cloudless (EOX)',
				},
			},
			layers: [
				{
					id: 'Satellite',
					type: 'raster' as const,
					source: 'satellite',
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
							anchor: 'map' as const,
							position: [1.5, 90, 80],
						},
					}
				: {}),
		};

		if (terrainUrl || terrainPmtilesUrl) {
			style.sources = {
				...style.sources,
				terrain: {
					type: 'raster-dem' as const,
					tiles: terrainPmtilesUrl
						? [`pmtiles://${terrainPmtilesUrl}/{z}/{x}/{y}`]
						: terrainUrl
							? [terrainUrl]
							: [],
					encoding: 'mapbox' as const,
					tileSize: 256,
				},
			};
		}

		map = new maplibregl.Map({
			container,
			zoom,
			center: [lon, lat],
			pitch,
			bearing,
			style,
			attributionControl: false,
			...((terrainUrl || terrainPmtilesUrl)
				? { terrain: 'terrain', terrainSource: 'terrain' }
				: {}),
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