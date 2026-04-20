<script lang="ts">
/**
 * VectorCloudLayer — GeoJSON-driven clouds rendered natively by MapLibre.
 *
 * Two-layer approach:
 * 1. FillLayer — large polygon covering the area around the camera with
 *    semi-transparent white fill. Creates the "cloud deck floor" that
 *    MapLibre renders with proper perspective. The horizon naturally
 *    shows this as a white band because it extends to the edge of view.
 * 2. SymbolLayer — individual cloud sprites at geographic positions for
 *    the billowy formations that rise above the deck.
 *
 * Both layers participate in MapLibre's 3D scene — proper depth sorting
 * with terrain, automatic perspective projection, horizon recession.
 */

import { GeoJSONSource, FillLayer, SymbolLayer, Image } from 'svelte-maplibre-gl';
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

// ── Cloud deck polygon ──────────────────────────────────────────────
// A large polygon covering ~8° around the camera. MapLibre renders this
// as a filled area on the globe. At cruise pitch (72°), the far edge
// Cloud deck = RING polygon. Outer boundary at 6° (far horizon), inner
// hole at 1.5° (near terrain stays visible). The ring only covers the
// DISTANT area where clouds would be at the horizon. MapLibre's
// perspective projection makes the ring's far edge appear as a bright
// white band at the horizon line.
const deckGeoJSON = $derived.by(() => {
	const outer = 6;  // outer ring edge (degrees from camera)
	const inner = 1.5; // inner hole (near terrain stays clear)
	const cosLat = Math.max(Math.cos(lat * Math.PI / 180), 0.2);

	// Generate approximate circles as 24-sided polygons
	const outerRing: [number, number][] = [];
	const innerRing: [number, number][] = [];
	for (let i = 0; i <= 24; i++) {
		const a = (i / 24) * Math.PI * 2;
		outerRing.push([lon + Math.cos(a) * outer / cosLat, lat + Math.sin(a) * outer]);
		innerRing.push([lon + Math.cos(a) * inner / cosLat, lat + Math.sin(a) * inner]);
	}
	// GeoJSON polygon with hole: outer ring CCW, inner ring CW
	innerRing.reverse();

	return {
		type: 'FeatureCollection' as const,
		features: [{
			type: 'Feature' as const,
			geometry: {
				type: 'Polygon' as const,
				coordinates: [outerRing, innerRing],
			},
			properties: {},
		}],
	};
});

// Higher opacity — this IS the horizon cloud band, needs to be visible
const deckOpacity = $derived(Math.min(0.6, density * 0.7) * (nightFactor > 0.5 ? 0.3 : 1));
const deckColor = $derived(nightFactor > 0.5 ? 'rgba(20, 28, 45, 0.7)' : 'rgba(248, 250, 255, 0.85)');

// ── Individual cloud sprites ────────────────────────────────────────
const CLOUD_SPRITES = [
	{ id: 'cloud-sprite-0', src: '/cloud.png' },
	{ id: 'cloud-sprite-1', src: '/cloud-01.png' },
	{ id: 'cloud-sprite-2', src: '/cloud-05.png' },
	{ id: 'cloud-sprite-3', src: '/cloud-07.png' },
];
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

// Generate cloud sprite positions — biased toward view direction
interface CloudFeature {
	type: 'Feature';
	geometry: { type: 'Point'; coordinates: [number, number] };
	properties: { sprite: string; size: number; opacity: number; rotation: number; sortKey: number };
}

const cloudCount = $derived(Math.max(10, Math.round(density * 40)));
const isStorm = $derived(weather === 'storm' || weather === 'rain' || weather === 'overcast');

let cloudGeoJSON = $state<GeoJSON.FeatureCollection>({
	type: 'FeatureCollection',
	features: [],
});

$effect(() => {
	void lat; void lon; void weather; void heading;
	const viewRad = (heading - 90) * Math.PI / 180;
	const cosLat = Math.max(Math.cos(lat * Math.PI / 180), 0.2);
	const sprites = isStorm ? STORM_SPRITES : CLOUD_SPRITES;
	const features: CloudFeature[] = [];

	for (let i = 0; i < cloudCount; i++) {
		const isFront = Math.random() < 0.6;
		const angle = isFront
			? viewRad + (Math.random() - 0.5) * Math.PI * 0.8
			: Math.random() * Math.PI * 2;
		const dist = isFront ? 1.0 + Math.random() * 4.0 : 0.3 + Math.random() * 2.5;

		const cLat = lat + Math.cos(angle) * dist;
		const cLon = lon + Math.sin(angle) * dist / cosLat;
		const distNorm = Math.min(dist / 5, 1);
		const size = (2.0 - distNorm * 0.8) * (0.5 + Math.random() * 0.8);
		const opacity = (0.85 - distNorm * 0.4) * (0.4 + Math.random() * 0.5);

		features.push({
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [cLon, cLat] },
			properties: {
				sprite: sprites[Math.floor(Math.random() * sprites.length)].id,
				size: Math.max(0.15, size),
				opacity: Math.max(0.08, Math.min(0.85, opacity)),
				rotation: Math.random() * 360,
				sortKey: dist,
			},
		});
	}
	cloudGeoJSON = { type: 'FeatureCollection', features };
});

// Drift at 2Hz
$effect(() => {
	const interval = setInterval(() => {
		const headRad = heading * Math.PI / 180;
		const dx = Math.cos(headRad) * 0.0003;
		const dy = Math.sin(headRad) * 0.00015;
		cloudGeoJSON = {
			type: 'FeatureCollection',
			features: cloudGeoJSON.features.map(f => ({
				...f,
				geometry: {
					...f.geometry,
					coordinates: [
						(f.geometry as any).coordinates[0] + dx,
						(f.geometry as any).coordinates[1] + dy,
					],
				},
			})),
		};
	}, 500);
	return () => clearInterval(interval);
});

const nightMul = $derived(nightFactor > 0.5 ? 0.4 : 1.0);
</script>

<!-- Register all cloud sprites as map images -->
{#if imagesReady}
	{#each ALL_SPRITES as s (s.id)}
		{@const img = loadedImages.get(s.id)}
		{#if img}
			<Image id={s.id} image={img} />
		{/if}
	{/each}
{/if}

<!-- CLOUD DECK — large white polygon covering the area around camera.
     At cruise pitch, the far edge IS the horizon cloud band.
     MapLibre renders it with native perspective — no CSS hack needed. -->
<GeoJSONSource id="cloud-deck-polygon" data={deckGeoJSON}>
	<FillLayer
		id="cloud-deck-fill"
		source="cloud-deck-polygon"
		paint={{
			'fill-color': deckColor,
			'fill-opacity': deckOpacity,
		}}
	/>
</GeoJSONSource>

<!-- CLOUD SPRITES — individual formations above the deck -->
<GeoJSONSource id="vector-clouds" data={cloudGeoJSON}>
	<SymbolLayer
		id="vector-cloud-layer"
		source="vector-clouds"
		layout={{
			'icon-image': ['get', 'sprite'],
			'icon-size': ['*', ['get', 'size'], 0.5],
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
