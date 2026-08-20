/**
 * Vector night roads — the licence-clean replacement for the CartoDB raster.
 *
 * The street grid is what makes a night city read as a city; VIIRS alone is a
 * soft blob. That grid came from `basemaps.cartocdn.com/dark_nolabels`, whose
 * terms put it behind CARTO Enterprise for commercial use — and 132 MB of the
 * 139 MB packaged tile cache was CARTO-derived (raw `cartodb-dark` plus the
 * baked `viirs-roads` composite built from it).
 *
 * The same geometry already sits in `data/roads/<city>.geojson`: OSM under
 * ODbL, 4.1 MB for all eight cities — 32× smaller than the tiles it replaces,
 * and critically it reaches the fleet, because `git pull` IS the deploy
 * mechanism and the 2.7 GB tile rsync has never happened.
 *
 * The night CURVE is not re-derived here. `roadMaskAlpha()` stays in imagery.ts
 * and is imported verbatim: it is the most carefully calibrated function in the
 * app and swapping the renderer underneath it is already enough change for one
 * commit.
 *
 * This was proposed and reverted twice before (fe043a0) on two objections, both
 * now stale: it needed a runtime Overpass call (the data is pre-baked and served
 * by /api/roads/:city), and it drew dots (that was a point-primitive attempt;
 * these are polylines).
 */
import type * as CesiumType from 'cesium';
import { groundAltM, LOCATION_MAP } from '$content/locations';
import type { LocationId } from '$lib/types';
import { altitudeDetailMix } from '$lib/world/altitude';
import { roadMaskAlpha } from '$lib/world/imagery';
import { registerViewerTeardown } from './viewer-lifecycle';

/** OSM highway classes the packager emits, brightest/widest first. */
export const ROAD_CLASSES = [
	'motorway',
	'trunk',
	'primary',
	'secondary',
	'tertiary',
	'residential',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

const ROAD_CLASS_SET = new Set<string>(ROAD_CLASSES);

/**
 * Per-class width (screen pixels) and alpha weight.
 *
 * ⚠ THESE ARE THE CALIBRATION KNOB — polyline width is CONSTANT SCREEN SPACE.
 * Unlike the raster it replaces, a line does not attenuate with altitude: the
 * same stroke that reads as an artery at 5,000 ft is moiré at 34,000 ft, where
 * 2,749 of Hyderabad's 3,447 features are `residential` alone. Tune at the
 * night-show band (~28,000 ft, see nightAltitude in the catalogue), not on a
 * desk at ground level.
 */
const ROAD_STYLE: Record<RoadClass, { width: number; alpha: number }> = {
	motorway: { width: 2.2, alpha: 1.0 },
	trunk: { width: 2.0, alpha: 0.95 },
	primary: { width: 1.8, alpha: 0.9 },
	secondary: { width: 1.4, alpha: 0.7 },
	tertiary: { width: 1.2, alpha: 0.55 },
	// The bulk of the features and the moiré risk. Additionally faded by
	// altitudeDetailMix at draw time — see roadClassAlpha.
	residential: { width: 1.0, alpha: 0.4 },
};

/**
 * Lift above the city ground, in metres.
 *
 * A line drawn exactly at terrain height z-fights it into a dashed shimmer.
 * ponytail: a constant lift, not draping. Ceiling — at grazing angles over
 * real relief the line can still clip into a hillside; the upgrade path is
 * GroundPolylinePrimitive, which drapes properly but costs a terrain-shadow
 * pass the Pi 5 does not have to spare.
 */
const ROAD_LIFT_M = 8;

/** A road ready to hand to Cesium: flat lon/lat pairs + its class. */
export interface RoadPolyline {
	/** Flattened [lon, lat, lon, lat, …] in degrees. */
	coords: number[];
	/** Altitude in metres AMSL (city ground × exaggeration, plus the lift). */
	altM: number;
	cls: RoadClass;
}

/**
 * GeoJSON FeatureCollection → polylines, in metres AMSL.
 *
 * Same ground-offset contract as buildings-geojson: `groundAltM` is what keeps
 * Denver's grid out of the mountain rather than 1,600 m underneath it, and
 * `exaggeration` mirrors scene.verticalExaggeration, which scales TERRAIN but
 * not primitives. Both failures are silent — no error, just no grid.
 *
 * Pure and exported so both can be asserted without a GPU.
 */
export function polylinesFromGeojson(
	geojson: unknown,
	locationId: LocationId,
	exaggeration = 1,
): RoadPolyline[] {
	const fc = geojson as { features?: unknown };
	if (!Array.isArray(fc?.features)) return [];

	const alt =
		groundAltM(locationId) * (Number.isFinite(exaggeration) ? exaggeration : 1) + ROAD_LIFT_M;
	const out: RoadPolyline[] = [];

	for (const raw of fc.features) {
		const f = raw as {
			geometry?: { type?: string; coordinates?: unknown };
			properties?: { class?: unknown };
		};
		if (f?.geometry?.type !== 'LineString') continue;
		const pts = f.geometry.coordinates;
		if (!Array.isArray(pts) || pts.length < 2) continue;

		const coords: number[] = [];
		for (const pt of pts) {
			if (!Array.isArray(pt) || pt.length < 2) continue;
			const [lon, lat] = pt as number[];
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
			if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
			// Drop repeated vertices: PolylineGeometry collapses a run of
			// duplicates to nothing and returns undefined, which surfaces as a
			// missing road rather than an error.
			const n = coords.length;
			if (n >= 2 && coords[n - 2] === lon && coords[n - 1] === lat) continue;
			coords.push(lon, lat);
		}
		// Two distinct vertices minimum to make a segment.
		if (coords.length < 4) continue;

		// Unknown or missing class is styled as residential rather than dropped:
		// a road the packager tagged in a way we did not anticipate should still
		// light up, just quietly. Total by construction — nothing is skipped.
		const c = f.properties?.class;
		const cls: RoadClass =
			typeof c === 'string' && ROAD_CLASS_SET.has(c) ? (c as RoadClass) : 'residential';

		out.push({ coords, altM: alt, cls });
	}
	return out;
}

/**
 * Final per-class alpha for one frame.
 *
 * `base` is roadMaskAlpha() — imported, not reimplemented. Residential is the
 * only class that additionally tracks altitudeDetailMix: it is 80% of the
 * feature count, and at cruise it is the difference between a legible grid and
 * a grey haze of aliased 1-px lines.
 *
 * Pure so the altitude behaviour is assertable without a GPU.
 */
export function roadClassAlpha(cls: RoadClass, base: number, altitudeFt: number): number {
	const w = ROAD_STYLE[cls].alpha;
	const detail = cls === 'residential' ? altitudeDetailMix(altitudeFt) : 1;
	return base * w * detail;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

interface CityRoads {
	/**
	 * One collection per highway class. Every polyline in a collection shares
	 * ONE Material instance, so the per-frame cost of the whole grid is one
	 * alpha write per class — five writes, not thousands.
	 */
	byClass: Map<RoadClass, { lines: CesiumType.PolylineCollection; material: CesiumType.Material }>;
}

/**
 * One cached entry per city, never destroyed once built — same reasoning as
 * buildings-geojson: eight fixed locations forever, and the operator asked that
 * geometry stop vanishing mid-flight.
 */
const _cityRoads = new Map<LocationId, CityRoads>();

/** In-flight loads, so a rapid hop sequence can't request the same city twice. */
const _inFlight = new Map<LocationId, Promise<void>>();

let _cs: typeof CesiumType | null = null;
let _viewer: CesiumType.Viewer | null = null;

/** True when this layer has anything to show for `id`. */
export function hasOfflineRoads(id: LocationId): boolean {
	return _cityRoads.has(id);
}

/**
 * Drop all cached collections. MUST run on every viewer (re)mount.
 *
 * The remount trap this repo has now hit five times (tileset, imagery layers,
 * EpsilonGates, offline buildings, and this): the map is a module singleton but
 * the VIEWER is not, so after a Cesium auto-retry / HMR / page nav every cached
 * collection belongs to a destroyed scene while hasOfflineRoads() still reports
 * the city as loaded — the loader early-returns, nothing joins the new scene,
 * and the grid is gone until a full reload.
 *
 * Clearing is enough: viewer.destroy() takes its own primitives with it.
 */
export function resetOfflineRoads(): void {
	_cityRoads.clear();
	_inFlight.clear();
}

export function initRoads(C: typeof CesiumType, viewer: CesiumType.Viewer): void {
	_cs = C;
	_viewer = viewer;
	resetOfflineRoads();
}

/**
 * Fetch + build the per-class collections for one city. Idempotent and cached.
 *
 * ─── ⚠ POLYLINECOLLECTION, NOT Primitive + PolylineGeometry ─────────────────
 * The obvious construction — GeometryInstances of PolylineGeometry in a single
 * batched Primitive, the way buildings-geojson batches its footprints — builds
 * and reports `ready: true`, `show: true`, a valid bounding sphere, and draws
 * NOTHING. Verified on a real GPU against a hardcoded control line in a
 * PolylineCollection at the same position, altitude and colour: the control
 * drew, the Primitive did not. Not depth (tested with depthTest off), not
 * translucency/OIT (tested opaque), not the lift (tested at 3,000 m), not
 * arcType.
 *
 * Do not "optimise" this back into a batched Primitive without a frame that
 * proves the lines are on screen. PolylineCollection does its own bucketing
 * anyway, which is what a batched Primitive was for.
 *
 * Failure is quiet by design: no grid is the state we were already in, and the
 * fiction is never broken with an error.
 */
export async function loadOfflineRoads(
	locationId: LocationId,
	exaggeration = 1,
): Promise<void> {
	const C = _cs;
	const viewer = _viewer;
	if (!C || !viewer) return;
	if (_cityRoads.has(locationId)) return;
	const existing = _inFlight.get(locationId);
	if (existing) return existing;

	const job = (async () => {
		try {
			const res = await fetch(`/api/roads/${locationId}`, { cache: 'force-cache' });
			if (!res.ok) return;
			const roads = polylinesFromGeojson(await res.json(), locationId, exaggeration);
			if (roads.length === 0) return;

			const byClass: CityRoads['byClass'] = new Map();
			for (const r of roads) {
				let entry = byClass.get(r.cls);
				if (!entry) {
					// ⚠ HOLD THE MATERIAL, NOT THE COLOR HANDED TO IT.
					// Material.fromType CLONES its uniforms, so the Color passed in
					// is not the one the shader reads. Writing to the outer object
					// left every line pinned at its construction alpha of 0 — a
					// layer fully present in the scene, drawing nothing.
					const material = C.Material.fromType('Color', {
						color: C.Color.fromCssColorString('#ffd9a0').withAlpha(0),
					});
					const lines = new C.PolylineCollection();
					lines.show = false;
					viewer.scene.primitives.add(lines);
					entry = { lines, material };
					byClass.set(r.cls, entry);
				}
				entry.lines.add({
					positions: C.Cartesian3.fromDegreesArrayHeights(withHeights(r.coords, r.altM)),
					width: ROAD_STYLE[r.cls].width,
					material: entry.material,
				});
			}

			if (byClass.size > 0) _cityRoads.set(locationId, { byClass });
		} catch {
			// Offline, malformed JSON, or no packaged data — stay silent.
		} finally {
			_inFlight.delete(locationId);
		}
	})();

	_inFlight.set(locationId, job);
	return job;
}

/** [lon,lat,…] + one altitude → [lon,lat,h,…], Cesium's fromDegreesArrayHeights shape. */
function withHeights(coords: number[], altM: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < coords.length; i += 2) out.push(coords[i], coords[i + 1], altM);
	return out;
}

/**
 * Per-frame update. Cheap enough to call unconditionally.
 *
 * Loads on demand, shows exactly the current city, hides everything else, and
 * writes at most one alpha uniform per class — and none at all during the day,
 * where every collection is simply hidden and costs zero draw calls.
 */
export function syncOfflineRoads(
	locationId: LocationId,
	nightFactor: number,
	nightLightScale: number,
	altitudeFt: number,
	bootFade = 1,
	exaggeration = 1,
): void {
	if (!_cs || !_viewer) return;

	// Same catalogue fact the buildings tier reads: nature locations (himalayas,
	// ocean, desert, clouds) have no street grid by design.
	const isCity = !!LOCATION_MAP.get(locationId)?.hasBuildings;
	if (isCity && !_cityRoads.has(locationId)) {
		void loadOfflineRoads(locationId, exaggeration);
	}

	// Same gate the raster used: below this the layer contributes nothing, so
	// hide rather than draw thousands of fully-transparent lines.
	const lit = isCity && nightFactor > 0.01;
	const base = lit ? roadMaskAlpha(nightFactor, nightLightScale, altitudeFt, bootFade) : 0;

	for (const [id, city] of _cityRoads) {
		const want = lit && id === locationId;
		for (const [cls, entry] of city.byClass) {
			if (entry.lines.show !== want) entry.lines.show = want;
			if (!want) continue;
			const a = roadClassAlpha(cls, base, altitudeFt);
			// The Material's OWN color — see the clone warning at construction.
			const uc = entry.material.uniforms.color as CesiumType.Color;
			if (Math.abs(uc.alpha - a) > 0.001) uc.alpha = a;
		}
	}
}

registerViewerTeardown('roads-geojson', resetOfflineRoads);
