<script lang="ts">
/**
 * VectorCloudLayer — GeoJSON-driven clouds rendered natively by MapLibre.
 *
 * Each cloud = a GeoJSON Point with properties (size, opacity, rotation, type).
 * MapLibre's SymbolLayer renders cloud.png sprites at geographic positions.
 * Perspective, depth sorting, and horizon recession happen AUTOMATICALLY
 * because clouds are part of the 3D map scene, not a CSS overlay.
 *
 * This is the SSOT for cloud rendering — replaces CSS 3D overlay approach
 * for horizon/distant clouds where depth sorting with terrain matters.
 *
 * Architecture:
 * - <Image> registers cloud.png as a map sprite
 * - GeoJSONSource holds cloud positions (updated at 2Hz)
 * - SymbolLayer renders sprites with data-driven size/opacity/rotation
 * - icon-allow-overlap + icon-ignore-placement = clouds can overlap freely
 */

import { GeoJSONSource, SymbolLayer, Image } from 'svelte-maplibre-gl';
import type { WeatherType } from '$lib/types';

let {
	lat = 25.2,
	lon = 55.3,
	density = 0.75,
	heading = 90,
	nightFactor = 0,
	weather = 'clear' as WeatherType,
}: {
	lat?: number;
	lon?: number;
	density?: number;
	heading?: number;
	nightFactor?: number;
	weather?: WeatherType;
} = $props();

// Load the cloud sprite image
let cloudImg = $state<HTMLImageElement | null>(null);
$effect(() => {
	const img = new window.Image();
	img.crossOrigin = 'anonymous';
	img.src = '/cloud.png';
	img.onload = () => { cloudImg = img; };
});

// Generate cloud positions around the current location
interface CloudFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: {
		size: number;
		opacity: number;
		rotation: number;
		sortKey: number;
	};
}

function generateClouds(
	centerLat: number,
	centerLon: number,
	count: number,
	headingDeg: number,
): CloudFeature[] {
	const features: CloudFeature[] = [];
	void headingDeg; // used for future wind-direction bias

	for (let i = 0; i < count; i++) {
		// Distribute clouds in a ~4° radius around the camera
		const angle = Math.random() * Math.PI * 2;
		const dist = 0.3 + Math.random() * 3.5; // 0.3° to 3.8° from center
		const lat = centerLat + Math.cos(angle) * dist;
		const lon = centerLon + Math.sin(angle) * dist / Math.cos(centerLat * Math.PI / 180);

		// Clouds further from camera = smaller, more transparent (perspective)
		const distNorm = dist / 4; // 0..1
		const size = (1.5 - distNorm * 0.8) * (0.6 + Math.random() * 0.8);
		const opacity = (0.7 - distNorm * 0.4) * (0.5 + Math.random() * 0.5);

		features.push({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [lon, lat] },
			properties: {
				size: Math.max(0.1, size),
				opacity: Math.max(0.05, Math.min(0.85, opacity)),
				rotation: Math.random() * 360,
				sortKey: dist, // further = lower sort key (drawn first)
			},
		});
	}
	return features;
}

// Cloud count and GeoJSON — regenerated at 2Hz for drift
const cloudCount = $derived(Math.max(8, Math.round(density * 35)));

let cloudGeoJSON = $state<GeoJSON.FeatureCollection>({
	type: 'FeatureCollection',
	features: [],
});

// Regenerate cloud positions when location changes
$effect(() => {
	void lat; void lon; void weather;
	cloudGeoJSON = {
		type: 'FeatureCollection',
		features: generateClouds(lat, lon, cloudCount, heading),
	};
});

// Slow drift — update positions at 2Hz
$effect(() => {
	const interval = setInterval(() => {
		const headRad = heading * Math.PI / 180;
		const drift = 0.0003; // degrees per update (~150m)
		const dx = Math.cos(headRad) * drift;
		const dy = Math.sin(headRad) * drift;

		cloudGeoJSON = {
			type: 'FeatureCollection',
			features: cloudGeoJSON.features.map(f => ({
				...f,
				geometry: {
					...f.geometry,
					coordinates: [
						((f.geometry as any).coordinates[0] + dx),
						((f.geometry as any).coordinates[1] + dy * 0.5),
					],
				},
			})),
		};
	}, 500);
	return () => clearInterval(interval);
});

// Night opacity multiplier
const nightMul = $derived(nightFactor > 0.5 ? 0.4 : 1.0);
</script>

<!-- Register cloud.png as a map sprite -->
{#if cloudImg}
	<Image id="cloud-sprite" image={cloudImg} />
{/if}

<!-- Cloud positions as GeoJSON points -->
<GeoJSONSource id="vector-clouds" data={cloudGeoJSON}>
	<SymbolLayer
		id="vector-cloud-layer"
		source="vector-clouds"
		layout={{
			'icon-image': 'cloud-sprite',
			'icon-size': ['*', ['get', 'size'], 0.4],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'icon-rotate': ['get', 'rotation'],
			'icon-rotation-alignment': 'map',
			'icon-pitch-alignment': 'map',
			'symbol-sort-key': ['get', 'sortKey'],
		}}
		paint={{
			'icon-opacity': ['*', ['get', 'opacity'], nightMul],
		}}
	/>
</GeoJSONSource>
