/**
 * CloudBillboardManager — Cesium-native clouds via BillboardCollection.
 *
 * Path 1 of the cloud migration. Parallel implementation behind
 * config.world.useCesiumClouds (default OFF) so the existing CSS3D
 * sprites keep shipping until billboards prove themselves visually.
 *
 * - One BillboardCollection per Pi = one GPU draw call for all clouds.
 * - Clouds positioned at lat/lon around the location, altitude ~8 km.
 * - Re-roll on weather / composition / location / density change.
 * - Seeded RNG (daySeed) so all 3 Pis in the panorama reproduce the
 *   same billboard layout on the same day.
 * - Reuses /cloud.webp etc. shipped by CSS3D paths.
 *
 * Pi-5 cost: ~80 clouds = one draw call. Replace CSS3D's ~200 DOM
 * nodes (per-frame compositing) with a perf win.
 */

import type * as CesiumType from 'cesium';
import type { WeatherType } from '$lib/types';
import {
	pickCloudComposition,
	type CloudComposition,
} from '$content/compositions/clouds';
import { createSeededRng, daySeed } from '$lib/world/prng';
import { randomBetween, pickRandom } from '$lib/utils';

const CLOUD_ALT_M = 8000;
const CLOUD_RADIUS_DEG = 2.5;
const CLOUD_SCALE_METRES_BASE = 3500;

const TEXTURES = {
	clear:    ['/cloud.webp'],
	cloudy:   ['/cloud.webp'],
	rain:     ['/cloud.webp', '/cloud-dark.webp'],
	overcast: ['/cloud-dark.webp', '/cloud-smoke.webp'],
	storm:    ['/cloud-dark.webp', '/cloud-smoke.webp'],
} satisfies Record<WeatherType, readonly string[]>;

type C = typeof CesiumType;

export interface CloudSlice {
	lat: number;
	lon: number;
	weather: WeatherType;
	density: number;
	altitudeFt: number;
	enabled: boolean;
}

export class CloudBillboardManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#collection: any = null;
	#lastKey = '';
	#mounted = false;

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	setup(): void {
		if (this.#mounted) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.#C as any;
		this.#collection = this.#viewer.scene.primitives.add(new C.BillboardCollection());
		this.#mounted = true;
	}

	sync(s: CloudSlice): void {
		if (!this.#collection) return;

		if (!s.enabled || s.density < 0.05) {
			if (this.#collection.length > 0) this.#collection.removeAll();
			this.#lastKey = '';
			return;
		}

		const key = `${Math.round(s.lat * 4)}|${Math.round(s.lon * 4)}|${s.weather}|${s.density.toFixed(2)}|${Math.round(s.altitudeFt / 1000)}`;
		if (key === this.#lastKey) return;
		this.#lastKey = key;

		this.#collection.removeAll();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.#C as any;
		const composition: CloudComposition = pickCloudComposition(s.weather);
		const textures = TEXTURES[s.weather] ?? TEXTURES.clear;

		const rng = createSeededRng(daySeed());

		const horizonCount = Math.max(
			composition.horizon.countMin,
			Math.round(s.density * composition.horizon.countMul),
		);
		const midCount = Math.max(
			composition.mid.countMin,
			Math.round(s.density * composition.mid.countMul),
		);

		const altGain = Math.max(0.7, Math.min(1.5, 30000 / Math.max(s.altitudeFt, 5000)));

		for (let i = 0; i < horizonCount; i++) {
			const dLat = randomBetween(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
			const dLon = randomBetween(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
			const scale = randomBetween(composition.horizon.scaleRange[0], composition.horizon.scaleRange[1], rng);
			const opacity = randomBetween(0.55, 0.92, rng);
			this.#collection.add({
				position: C.Cartesian3.fromDegrees(s.lon + dLon, s.lat + dLat, CLOUD_ALT_M),
				image: pickRandom(textures, rng),
				color: new C.Color(1, 1, 1, opacity),
				scale: scale * altGain,
				sizeInMeters: false,
				width: CLOUD_SCALE_METRES_BASE,
				height: CLOUD_SCALE_METRES_BASE * 0.5,
				translucencyByDistance: new C.NearFarScalar(50_000, 1.0, 400_000, 0.4),
			});
		}

		const midRadius = CLOUD_RADIUS_DEG * 0.6;
		for (let i = 0; i < midCount; i++) {
			const dLat = randomBetween(-midRadius, midRadius, rng);
			const dLon = randomBetween(-midRadius, midRadius, rng);
			const scale = randomBetween(composition.mid.scaleRange[0], composition.mid.scaleRange[1], rng);
			const opacity = randomBetween(0.65, 0.95, rng);
			this.#collection.add({
				position: C.Cartesian3.fromDegrees(s.lon + dLon, s.lat + dLat, CLOUD_ALT_M * 0.7),
				image: pickRandom(textures, rng),
				color: new C.Color(1, 1, 1, opacity),
				scale: scale * altGain,
				width: CLOUD_SCALE_METRES_BASE * 0.7,
				height: CLOUD_SCALE_METRES_BASE * 0.35,
				translucencyByDistance: new C.NearFarScalar(30_000, 1.0, 250_000, 0.3),
			});
		}
	}

	destroy(): void {
		if (this.#collection) {
			this.#viewer.scene.primitives.remove(this.#collection);
			this.#collection = null;
			this.#mounted = false;
		}
	}
}
