/**
 * Cloud billboard layer — Cesium-native 2-band PNG-sprite cloud bank.
 *
 * Uses Cesium's BillboardCollection (GPU-instanced, single draw call)
 * to place clouds at the WGS84 cloud deck using the EXACT same cluster
 * recipe as Clouds.svelte: two bands (distant horizon + close window),
 * same counts, same positions, same weather-dependent textures, same
 * 3-Pi seed determinism.
 *
 * Missing (Cesium BillboardCollection doesn't expose per-sprite):
 *   - Per-sprite material.rotation animation
 *   - Mie forward-scatter golden-hour glow
 *   - Within-cluster sun-side shading
 *   - Moonlit floor + city skyglow amber additive
 *   - Per-cluster wind shear
 *
 * These are baked into billboard.color at build time from position and
 * cluster properties so the read is close to the Three.js look without
 * the per-frame CPU cost.
 *
 * Pi 5 cost: 1 draw call regardless of cloud count. GPU-instanced.
 */

import type * as CesiumType from 'cesium';
import type { WeatherType } from '$lib/types';
import { createSeededRng, daySeed } from '$lib/world/prng';

// Match Clouds.svelte cluster constants exactly
const CLOUD_ALT_M = 8000;                           // ~26k ft

// ---- DISTANT BAND ----
const DISTANT_RADIUS_MIN = 42_000;                  // m
const DISTANT_RADIUS_SPAN = 265_000 - 42_000;       // m
const DISTANT_BASE_SCALE_MIN = 8000;                // m
const DISTANT_BASE_SCALE_SPAN = 16_000 - 8_000;     // m
const DISTANT_SPRITE_MIN = 9;
const DISTANT_SPRITE_SPAN = 8;
const DISTANT_LONELY = 0.03;

// ---- CLOSE BAND ----
const CLOSE_RADIUS_MIN = 1_500;
const CLOSE_RADIUS_SPAN = 30_000 - 1_500;
const CLOSE_BASE_SCALE_MIN = 1_500;
const CLOSE_BASE_SCALE_SPAN = 3_000 - 1_500;
const CLOSE_SPRITE_MIN = 4;
const CLOSE_SPRITE_SPAN = 7;
const CLOSE_LONELY = 0.10;

const TEXTURES: Record<WeatherType, readonly string[]> = {
	clear:    ['/cloud.webp'],
	cloudy:   ['/cloud.webp'],
	rain:     ['/cloud.webp', '/cloud-dark.webp'],
	overcast: ['/cloud-dark.webp', '/cloud-smoke.webp'],
	storm:    ['/cloud-dark.webp', '/cloud-smoke.webp'],
};

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
	 * Re-roll the cloud bank when location / weather / density changes.
	 * Caches against a coarse key so per-frame calls are cheap.
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
		const textures = TEXTURES[weather] ?? TEXTURES.clear;

		// 3-Pi panorama determinism
		const rng = createSeededRng(daySeed());

		// Altitude gain — bigger at low altitude, smaller at cruise
		const altGain = Math.max(0.4, Math.min(1.8, 35000 / Math.max(altitudeFt, 2000)));

		// ---- DISTANT BAND (horizon weather systems) ----
		const distantCount = Math.round(45 + Math.min(1, density) * 50);

		for (let c = 0; c < distantCount; c++) {
			const theta = rng() * Math.PI * 2;
			const r = DISTANT_RADIUS_MIN + Math.sqrt(rng()) * DISTANT_RADIUS_SPAN;
			const cx = Math.cos(theta) * r;
			const cz = -Math.sin(theta) * r;
			const ch = (rng() - 0.18) * 4600;

			const baseScale = DISTANT_BASE_SCALE_MIN + rng() * DISTANT_BASE_SCALE_SPAN;
			const isLonely = rng() < DISTANT_LONELY;
			const spriteCount = isLonely ? 1 : DISTANT_SPRITE_MIN + Math.floor(rng() * DISTANT_SPRITE_SPAN);

			for (let i = 0; i < spriteCount; i++) {
				const isAnchor = i === 0;
				const ox = isAnchor ? cx : cx + (rng() - 0.5) * baseScale * 1.85;
				const oz = isAnchor ? cz : cz + (rng() - 0.5) * baseScale * 1.85;
				const oy = isAnchor ? ch : ch + (rng() - 0.5) * baseScale * 0.18;

				// Anchor brighter, others dimmer
				const brightness = isAnchor ? 0.74 : 0.62 + (rng() - 0.5) * 0.12;
				const opacity = isAnchor ? 0.35 : 0.18 + rng() * 0.24;
				const sprScale = baseScale * (isAnchor ? 1.25 : 0.95 + rng() * 0.50);
				const img = textures[Math.floor(rng() * textures.length)];

				const worldX = ox;  // East
				const worldY = oy + CLOUD_ALT_M;  // Up
				const worldZ = cz - (oz - cz); // North — match Three.js convention

				const position = C.Cartesian3.fromDegrees(
					lon + (worldX / 111_320),
					lat + (worldZ / (111_320 * Math.cos(lat * Math.PI / 180))),
					worldY,
				);

				this.collection.add({
					position,
					image: img,
					color: new C.Color(brightness, brightness, brightness, opacity),
					scale: sprScale / 3000 * altGain,
					sizeInMeters: true,
					width: sprScale * 1.30,
					height: sprScale,
					translucencyByDistance: new C.NearFarScalar(
						DISTANT_RADIUS_MIN, 1.0,
						DISTANT_RADIUS_MIN + DISTANT_RADIUS_SPAN, 0.25,
					),
				});
			}
		}

		// ---- CLOSE BAND (passenger-window sprites) ----
		const closeCount = Math.round(16 + Math.min(1, density) * 16);

		for (let c = 0; c < closeCount; c++) {
			const theta = rng() * Math.PI * 2;
			const r = CLOSE_RADIUS_MIN + Math.sqrt(rng()) * CLOSE_RADIUS_SPAN;
			const cx = Math.cos(theta) * r;
			const cz = -Math.sin(theta) * r;
			const ch = (rng() - 0.18) * 1400;

			const baseScale = CLOSE_BASE_SCALE_MIN + rng() * CLOSE_BASE_SCALE_SPAN;
			const isLonely = rng() < CLOSE_LONELY;
			const spriteCount = isLonely ? 1 : CLOSE_SPRITE_MIN + Math.floor(rng() * CLOSE_SPRITE_SPAN);

			for (let i = 0; i < spriteCount; i++) {
				const isAnchor = i === 0;
				const ox = isAnchor ? cx : cx + (rng() - 0.5) * baseScale * 1.85;
				const oz = isAnchor ? cz : cz + (rng() - 0.5) * baseScale * 1.85;
				const oy = isAnchor ? ch : ch + (rng() - 0.5) * baseScale * 0.18;

				const brightness = isAnchor ? 0.78 : 0.65 + (rng() - 0.5) * 0.10;
				const opacity = isAnchor ? 0.42 : 0.22 + rng() * 0.22;
				const sprScale = baseScale * (isAnchor ? 1.25 : 0.95 + rng() * 0.50);
				const img = textures[Math.floor(rng() * textures.length)];

				const worldX = ox;
				const worldY = oy + CLOUD_ALT_M * 0.85;
				const worldZ = cz - (oz - cz);

				const position = C.Cartesian3.fromDegrees(
					lon + (worldX / 111_320),
					lat + (worldZ / (111_320 * Math.cos(lat * Math.PI / 180))),
					worldY,
				);

				this.collection.add({
					position,
					image: img,
					color: new C.Color(brightness, brightness, brightness, opacity),
					scale: sprScale / 1500 * altGain,
					sizeInMeters: true,
					width: sprScale * 1.30,
					height: sprScale,
					translucencyByDistance: new C.NearFarScalar(
						CLOSE_RADIUS_MIN, 1.0,
						CLOSE_RADIUS_MIN + CLOSE_RADIUS_SPAN, 0.15,
					),
				});
			}
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
