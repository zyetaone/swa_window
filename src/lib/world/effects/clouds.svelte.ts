/**
 * clouds — Cesium-native cloud bank via BillboardCollection.
 *
 * Reactive feature. The BillboardCollection is created once at mount;
 * the cloud positions are recomputed whenever weather, density,
 * location, or altitude changes (cache-keyed by a coarse hash so
 * per-frame calls are cheap).
 *
 * 3-Pi panorama determinism: positions are seeded with daySeed() so
 * all Pis in a panorama group generate identical billboard layouts on
 * the same day.
 *
 * Note: there are TWO cloud systems. This Cesium-native bank is
 * gated behind `config.world.useCesiumClouds`. The other system is
 * the Three.js ArtsyClouds CSS3D-style cluster sprites — that one
 * ships by default for the curated sky read. Both ship together when
 * the flag is on (they live in different render paths and don't
 * conflict).
 */

import type * as CesiumType from 'cesium';
import type { WeatherType } from '$lib/types';
import {
	pickCloudComposition,
	type CloudComposition,
} from '$content/compositions/clouds';
import { createSeededRng, daySeed } from '../prng';
import { randomBetween, pickRandom } from '$lib/utils';
import { activeCesium } from '../active.svelte';

const CLOUD_ALT_M = 8000;             // clouds sit ~26k ft up — typical mid-deck
const CLOUD_RADIUS_DEG = 2.5;         // spread half-extent around the location
const CLOUD_SCALE_METRES_BASE = 3500;  // billboard width in metres

const TEXTURES: Record<WeatherType, readonly string[]> = {
	clear:    ['/cloud.webp'],
	cloudy:   ['/cloud.webp'],
	rain:     ['/cloud.webp', '/cloud-dark.webp'],
	overcast: ['/cloud-dark.webp', '/cloud-smoke.webp'],
	storm:    ['/cloud-dark.webp', '/cloud-smoke.webp'],
};

/** Module-private collection — created once at mount, mutated on updates. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let collection: any = null;
let mounted = false;
let lastKey = '';

/** Add a single horizon-band cloud. */
function addHorizonCloud(
	C: typeof CesiumType,
	collection: CesiumType.BillboardCollection,
	lat: number, lon: number, scale: number, opacity: number, texture: string,
	altGain: number,
) {
	collection.add({
		position: C.Cartesian3.fromDegrees(lon, lat, CLOUD_ALT_M),
		image: texture,
		color: new C.Color(1, 1, 1, opacity),
		scale: scale * altGain,
		sizeInMeters: false,
		width: CLOUD_SCALE_METRES_BASE,
		height: CLOUD_SCALE_METRES_BASE * 0.5,
		translucencyByDistance: new C.NearFarScalar(50_000, 1.0, 400_000, 0.4),
	});
}

/** Add a single mid-band cloud (closer, smaller). */
function addMidCloud(
	C: typeof CesiumType,
	collection: CesiumType.BillboardCollection,
	lat: number, lon: number, scale: number, opacity: number, texture: string,
	altGain: number,
) {
	collection.add({
		position: C.Cartesian3.fromDegrees(lon, lat, CLOUD_ALT_M * 0.7),
		image: texture,
		color: new C.Color(1, 1, 1, opacity),
		scale: scale * altGain,
		width: CLOUD_SCALE_METRES_BASE * 0.7,
		height: CLOUD_SCALE_METRES_BASE * 0.35,
		translucencyByDistance: new C.NearFarScalar(30_000, 1.0, 250_000, 0.3),
	});
}

/**
 * One-time mount: create the BillboardCollection and add it to the
 * scene. Idempotent.
 */
export function mountClouds(): void {
	if (mounted) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const viewer = mgr.getViewer();
	const C = mgr.getCesium() as any;
	collection = viewer.scene.primitives.add(new C.BillboardCollection());
	mounted = true;
}

/** Tear down the collection. Idempotent. */
export function destroyClouds(): void {
	if (!collection) return;
	const mgr = activeCesium.manager;
	if (mgr) mgr.getViewer().scene.primitives.remove(collection);
	collection = null;
	mounted = false;
	lastKey = '';
}

/**
 * Re-roll the cloud bank when location / weather / density / enabled
 * changes. Caches against a coarse key so per-frame calls are cheap.
 */
export function updateClouds(
	lat: number,
	lon: number,
	weather: WeatherType,
	density: number,
	altitudeFt: number,
	enabled: boolean,
): void {
	if (!collection || !mounted) return;

	if (!enabled || density < 0.05) {
		if (collection.length > 0) collection.removeAll();
		lastKey = '';
		return;
	}

	const key = `${Math.round(lat * 4)}|${Math.round(lon * 4)}|${weather}|${density.toFixed(2)}|${Math.round(altitudeFt / 1000)}`;
	if (key === lastKey) return;
	lastKey = key;

	collection.removeAll();

	const mgr = activeCesium.manager;
	if (!mgr) return;
	const C = mgr.getCesium();

	const composition: CloudComposition = pickCloudComposition(weather);
	const textures = TEXTURES[weather] ?? TEXTURES.clear;

	// 3-Pi panorama determinism: seed with daySeed() so identical
	// billboard layouts across all Pis on the same day.
	const rng = createSeededRng(daySeed());

	const horizonCount = Math.max(
		composition.horizon.countMin,
		Math.round(density * composition.horizon.countMul),
	);
	const midCount = Math.max(
		composition.mid.countMin,
		Math.round(density * composition.mid.countMul),
	);

	// Foreground gain — cloud size ramps up as the cabin descends.
	const altGain = Math.max(0.7, Math.min(1.5, 30000 / Math.max(altitudeFt, 5000)));

	for (let i = 0; i < horizonCount; i++) {
		const dLat = randomBetween(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
		const dLon = randomBetween(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
		const scale = randomBetween(composition.horizon.scaleRange[0], composition.horizon.scaleRange[1], rng);
		const opacity = randomBetween(0.55, 0.92, rng);
		addHorizonCloud(C, collection, lat + dLat, lon + dLon, scale, opacity, pickRandom(textures, rng), altGain);
	}

	const midRadius = CLOUD_RADIUS_DEG * 0.6;
	for (let i = 0; i < midCount; i++) {
		const dLat = randomBetween(-midRadius, midRadius, rng);
		const dLon = randomBetween(-midRadius, midRadius, rng);
		const scale = randomBetween(composition.mid.scaleRange[0], composition.mid.scaleRange[1], rng);
		const opacity = randomBetween(0.65, 0.95, rng);
		addMidCloud(C, collection, lat + dLat, lon + dLon, scale, opacity, pickRandom(textures, rng), altGain);
	}
}
