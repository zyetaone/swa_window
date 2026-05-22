/**
 * Road layer — Vector roads from OpenStreetMap via Overpass API.
 * 
 * Renders as a BillboardCollection of glowing dots. GPU-batched.
 * Gated by config.world.roadsEnabled (Phase 5/6 productionized).
 * 
 * Performance: ~2-5k roads per city. Billboards are cheap.
 * Fetching: Caches GeoJSON locally to avoid Overpass rate limits.
 */

import type * as CesiumType from 'cesium';

export type RoadClass = 'motorway' | 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential';

const ROAD_COLORS: Record<RoadClass, [number, number, number]> = {
	motorway: [255, 180, 50],    // Amber
	trunk: [255, 160, 40],
	primary: [255, 140, 30],
	secondary: [255, 120, 20],
	tertiary: [255, 100, 10],
	residential: [255, 80, 0],   // Deep Orange
};

const ROAD_WIDTHS: Record<RoadClass, number> = {
	motorway: 3.5,
	trunk: 2.8,
	primary: 2.2,
	secondary: 1.8,
	tertiary: 1.4,
	residential: 1.0,
};

const HDR_GAIN = 1.8;

export class RoadLayer {
	private collection: any = null;
	private mounted = false;
	private lastKey = '';
	private cache = new Map<string, any>();

	constructor(
		private C: typeof CesiumType,
		private viewer: CesiumType.Viewer,
	) {}

	mount(): void {
		if (this.mounted) return;
		const C = this.C as any;
		this.collection = this.viewer.scene.primitives.add(new C.BillboardCollection());
		this.mounted = true;
	}

	async update(
		lat: number,
		lon: number,
		enabled: boolean,
		intensity: number,
		glowWidth: number,
		motorwayBoost: number,
		residentialBoost: number,
	): Promise<void> {
		if (!this.collection) return;

		if (!enabled) {
			if (this.collection.length > 0) this.collection.removeAll();
			this.lastKey = '';
			return;
		}

		// Coarse key: re-fetch if moved > ~5km (0.05 deg)
		const key = `${Math.round(lat * 20)}|${Math.round(lon * 20)}`;
		if (key === this.lastKey) {
			// Still update the billboard colors/scale if tunables changed
			this.syncTunables(intensity, glowWidth, motorwayBoost, residentialBoost);
			return;
		}
		this.lastKey = key;

		const fc = await this.fetchRoads(lat, lon);
		if (!fc) return;

		this.collection.removeAll();
		const C = this.C as any;
		const circleUrl = C.buildModuleUrl('Assets/Textures/maki/circle.png');

		for (const feat of fc.features) {
			const hw = feat.properties.highway as RoadClass;
			const color = ROAD_COLORS[hw] || [255, 255, 255];
			const baseWidth = ROAD_WIDTHS[hw] || 1.0;
			const boost = hw === 'motorway' ? motorwayBoost : hw === 'residential' ? residentialBoost : 1.0;

			for (const [lon, lat] of feat.geometry.coordinates) {
				this.collection.add({
					position: C.Cartesian3.fromDegrees(lon, lat, 2.0),
					image: circleUrl,
					color: new C.Color(
						(color[0] / 255) * HDR_GAIN,
						(color[1] / 255) * HDR_GAIN,
						(color[2] / 255) * HDR_GAIN,
						Math.min(intensity * boost, 1.0),
					),
					scale: baseWidth * glowWidth * 0.035,
					scaleByDistance: new C.NearFarScalar(1000, 1.0, 500000, 0.1),
					// Custom tag for syncTunables
					_hw: hw,
				});
			}
		}
	}

	private syncTunables(intensity: number, glowWidth: number, motorwayBoost: number, residentialBoost: number): void {
		const C = this.C as any;
		const len = this.collection.length;
		for (let i = 0; i < len; i++) {
			const b = this.collection.get(i);
			const hw = b._hw as RoadClass;
			const color = ROAD_COLORS[hw] || [255, 255, 255];
			const baseWidth = ROAD_WIDTHS[hw] || 1.0;
			const boost = hw === 'motorway' ? motorwayBoost : hw === 'residential' ? residentialBoost : 1.0;

			b.color = new C.Color(
				(color[0] / 255) * HDR_GAIN,
				(color[1] / 255) * HDR_GAIN,
				(color[2] / 255) * HDR_GAIN,
				Math.min(intensity * boost, 1.0),
			);
			b.scale = baseWidth * glowWidth * 0.035;
		}
	}

	private async fetchRoads(lat: number, lon: number): Promise<any> {
		const bbox = `${lat - 0.1},${lon - 0.2},${lat + 0.1},${lon + 0.2}`;
		if (this.cache.has(bbox)) return this.cache.get(bbox);

		try {
			const query = `[out:json][bbox:${bbox}];(way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential)$"];);out geom;`;
			const resp = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
			if (!resp.ok) return null;
			const data = await resp.json();

			const fc = { type: 'FeatureCollection', features: [] as any[] };
			for (const el of data.elements) {
				if (el.type === 'way' && el.geometry && el.tags?.highway) {
					fc.features.push({
						type: 'Feature',
						geometry: { type: 'LineString', coordinates: el.geometry.map((pt: any) => [pt.lon, pt.lat]) },
						properties: { highway: el.tags.highway },
					});
				}
			}
			this.cache.set(bbox, fc);
			return fc;
		} catch (e) {
			console.error('[RoadLayer] Fetch failed:', e);
			return null;
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
