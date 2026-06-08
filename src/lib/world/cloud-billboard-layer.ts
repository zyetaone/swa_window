/**
 * Cloud billboard layer — Cesium-native clouds as a BillboardCollection.
 *
 * Reframe context (2026-05-22): clouds belong in SKY (Cesium primitives),
 * not on the pane. This is path 1 of the migration — parallel
 * implementation behind config.world.useCesiumClouds. Default OFF so the
 * existing artsy CSS3D sprites keep shipping until billboards prove
 * themselves visually.
 *
 * Approach:
 *   - One BillboardCollection (GPU-batched, single draw call for up to
 *     thousands of clouds).
 *   - Clouds positioned at lat/lon around the current location, altitude
 *     ≈ 8000 m so they're visibly between the camera (cruise ~10 km)
 *     and the terrain. Camera bank parallaxes them correctly.
 *   - Re-roll on weather + composition + location change.
 *   - Reuses /cloud.webp / /cloud-dark.webp / /cloud-smoke.webp the
 *     CSS3D sprites already ship.
 *
 * Pi 5 cost: BillboardCollection is GPU-batched. ~80 clouds = one draw
 * call. Compare to CSS3D's ~200 DOM elements (per-frame compositing),
 * this is a perf WIN.
 */

import type * as CesiumType from 'cesium';
import type { WeatherType } from '$lib/types';
import {
	pickCloudComposition,
	type CloudComposition,
} from '$content/compositions/clouds';
import { createSeededRng, daySeed } from '$lib/world-three/prng';

const CLOUD_ALT_M = 8000;             // clouds sit ~26k ft up — typical mid-deck
const CLOUD_RADIUS_DEG = 2.5;         // spread half-extent around the location
// Image scale in metres (Cesium billboards measure in metres at the
// billboard's position). At cruise altitude these read as visibly large
// cloud puffs.
const CLOUD_SCALE_METRES_BASE = 3500;

const TEXTURES = {
	clear:    ['/cloud.webp'],
	cloudy:   ['/cloud.webp'],
	rain:     ['/cloud.webp', '/cloud-dark.webp'],
	overcast: ['/cloud-dark.webp', '/cloud-smoke.webp'],
	storm:    ['/cloud-dark.webp', '/cloud-smoke.webp'],
} satisfies Record<WeatherType, readonly string[]>;

// Helpers accept an optional `rng` — `update()` passes a daySeed-seeded
// rng so all three Pis in a panorama group generate identical billboard
// positions on the same day. Falls back to Math.random for any test or
// non-3-Pi caller.
function rand(min: number, max: number, rng: () => number = Math.random) {
	return min + rng() * (max - min);
}
function pickRand<T>(arr: readonly T[], rng: () => number = Math.random): T {
	return arr[Math.floor(rng() * arr.length)];
}

export class CloudBillboardLayer {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private collection: any = null;
	private lastKey = '';
	private mounted = false;

	constructor(
		private C: typeof CesiumType,
		private viewer: CesiumType.Viewer,
	) {}

	mount(): void {
		if (this.mounted) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.C as any;
		this.collection = this.viewer.scene.primitives.add(new C.BillboardCollection());
		this.mounted = true;
	}

	/**
	 * Re-roll the cloud bank when location / weather / density / enabled
	 * changes. Caches against a coarse key so per-frame calls are cheap.
	 */
	update(
		lat: number,
		lon: number,
		weather: WeatherType,
		density: number,
		altitudeFt: number,
		enabled: boolean,
	): void {
		if (!this.collection) return;

		if (!enabled || density < 0.05) {
			if (this.collection.length > 0) this.collection.removeAll();
			this.lastKey = '';
			return;
		}

		const key = `${Math.round(lat * 4)}|${Math.round(lon * 4)}|${weather}|${density.toFixed(2)}|${Math.round(altitudeFt / 1000)}`;
		if (key === this.lastKey) return;
		this.lastKey = key;

		this.collection.removeAll();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const C = this.C as any;
		const composition: CloudComposition = pickCloudComposition(weather);
		const textures = TEXTURES[weather] ?? TEXTURES.clear;

		// 3-Pi panorama determinism: seed with daySeed() so identical
		// billboard layouts across all Pis on the same day. Re-seeded on
		// each update() call — including the same lat/lon+weather+density
		// key produces the same layout, so the cache check above (key
		// comparison) still skips identical-state rebuilds correctly.
		const rng = createSeededRng(daySeed());

		// Use the same horizon + mid recipe shape as ArtsyClouds — but
		// instead of mapping countMul × density to a screen y-band, we
		// place each cloud in WORLD coordinates around (lat, lon). The
		// horizon recipe gets further-away clouds (larger lat/lon spread),
		// the mid recipe gets closer ones.
		const horizonCount = Math.max(
			composition.horizon.countMin,
			Math.round(density * composition.horizon.countMul),
		);
		const midCount = Math.max(
			composition.mid.countMin,
			Math.round(density * composition.mid.countMul),
		);

		// Foreground gain — cloud size ramps up as the cabin descends so
		// at low altitude they read closer and bigger.
		const altGain = Math.max(0.7, Math.min(1.5, 30000 / Math.max(altitudeFt, 5000)));

		for (let i = 0; i < horizonCount; i++) {
			const dLat = rand(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
			const dLon = rand(-CLOUD_RADIUS_DEG, CLOUD_RADIUS_DEG, rng);
			const scale = rand(composition.horizon.scaleRange[0], composition.horizon.scaleRange[1], rng);
			const opacity = rand(0.55, 0.92, rng);
			this.collection.add({
				position: C.Cartesian3.fromDegrees(lon + dLon, lat + dLat, CLOUD_ALT_M),
				image: pickRand(textures, rng),
				color: new C.Color(1, 1, 1, opacity),
				scale: scale * altGain,
				sizeInMeters: false,
				width: CLOUD_SCALE_METRES_BASE,
				height: CLOUD_SCALE_METRES_BASE * 0.5,
				translucencyByDistance: new C.NearFarScalar(
					50_000, 1.0,
					400_000, 0.4,
				),
			});
		}

		// Mid clouds — closer to the camera, smaller spread.
		const midRadius = CLOUD_RADIUS_DEG * 0.6;
		for (let i = 0; i < midCount; i++) {
			const dLat = rand(-midRadius, midRadius, rng);
			const dLon = rand(-midRadius, midRadius, rng);
			const scale = rand(composition.mid.scaleRange[0], composition.mid.scaleRange[1], rng);
			const opacity = rand(0.65, 0.95, rng);
			this.collection.add({
				position: C.Cartesian3.fromDegrees(lon + dLon, lat + dLat, CLOUD_ALT_M * 0.7),
				image: pickRand(textures, rng),
				color: new C.Color(1, 1, 1, opacity),
				scale: scale * altGain,
				width: CLOUD_SCALE_METRES_BASE * 0.7,
				height: CLOUD_SCALE_METRES_BASE * 0.35,
				translucencyByDistance: new C.NearFarScalar(
					30_000, 1.0,
					250_000, 0.3,
				),
			});
		}
	}

	destroy(): void {
		if (this.collection) {
			this.viewer.scene.primitives.remove(this.collection);
			this.collection = null;
			this.mounted = false;
		}
	}
}
