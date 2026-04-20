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

// Load multiple cloud sprite textures for variety
const CLOUD_SPRITES = [
	{ id: 'cloud-sprite-0', src: '/cloud.png' },
	{ id: 'cloud-sprite-1', src: '/cloud-01.png' },
	{ id: 'cloud-sprite-2', src: '/cloud-05.png' },
	{ id: 'cloud-sprite-3', src: '/cloud-07.png' },
];
// Dark/storm variants
const STORM_SPRITES = [
	{ id: 'cloud-sprite-dark', src: '/cloud-dark.png' },
	{ id: 'cloud-sprite-gray', src: '/cloud-03.png' },
	{ id: 'cloud-sprite-smoke', src: '/cloud-smoke.png' },
];
const ALL_SPRITES = [...CLOUD_SPRITES, ...STORM_SPRITES];

let loadedImages = $state<Map<string, HTMLImageElement>>(new Map());
$effect(() => {
	const map = new Map<string, HTMLImageElement>();
	let loaded = 0;
	for (const s of ALL_SPRITES) {
		const img = new window.Image();
		img.crossOrigin = 'anonymous';
		img.src = s.src;
		img.onload = () => {
			map.set(s.id, img);
			loaded++;
			if (loaded === ALL_SPRITES.length) loadedImages = new Map(map);
		};
	}
});
const imagesReady = $derived(loadedImages.size === ALL_SPRITES.length);

// Generate cloud positions around the current location
interface CloudFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: {
		sprite: string;  // icon-image ID
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
	// Passenger looks 90° left of heading — that's the view direction.
	// Concentrate clouds TOWARD the horizon in the view direction.
	const viewRad = (headingDeg - 90) * Math.PI / 180;

	for (let i = 0; i < count; i++) {
		// Bias distribution toward view direction for horizon clouds.
		// 60% of clouds go in the forward-view hemisphere, 40% elsewhere.
		const isFrontBiased = Math.random() < 0.6;
		const angle = isFrontBiased
			? viewRad + (Math.random() - 0.5) * Math.PI * 0.8  // ±72° from view direction
			: Math.random() * Math.PI * 2;                       // full circle

		// Distance: front-biased clouds go FURTHER (toward horizon)
		const dist = isFrontBiased
			? 1.0 + Math.random() * 4.0   // 1°-5° from center (toward horizon)
			: 0.3 + Math.random() * 2.5;  // 0.3°-2.8° (nearer, scattered)

		const cosLat = Math.cos(centerLat * Math.PI / 180);
		const lat = centerLat + Math.cos(angle) * dist;
		const lon = centerLon + Math.sin(angle) * dist / Math.max(cosLat, 0.2);

		// Clouds further from camera = slightly smaller, more transparent
		const distNorm = Math.min(dist / 5, 1);
		const size = (1.8 - distNorm * 0.6) * (0.5 + Math.random() * 0.8);
		const opacity = (0.8 - distNorm * 0.35) * (0.4 + Math.random() * 0.5);

		// Pick sprite based on weather
		const isStorm = weather === 'storm' || weather === 'rain' || weather === 'overcast';
		const sprites = isStorm ? STORM_SPRITES : CLOUD_SPRITES;
		const sprite = sprites[Math.floor(Math.random() * sprites.length)].id;

		features.push({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [lon, lat] },
			properties: {
				sprite,
				size: Math.max(0.1, size),
				opacity: Math.max(0.05, Math.min(0.85, opacity)),
				rotation: Math.random() * 360,
				sortKey: dist,
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

<!-- Register ALL cloud sprites as map images -->
{#if imagesReady}
	{#each ALL_SPRITES as s (s.id)}
		{@const img = loadedImages.get(s.id)}
		{#if img}
			<Image id={s.id} image={img} />
		{/if}
	{/each}
{/if}

<!-- Cloud positions as GeoJSON points — icon-image is data-driven per feature -->
<GeoJSONSource id="vector-clouds" data={cloudGeoJSON}>
	<SymbolLayer
		id="vector-cloud-layer"
		source="vector-clouds"
		layout={{
			'icon-image': ['get', 'sprite'],
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
