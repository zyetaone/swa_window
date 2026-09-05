/**
 * Offline buildings — the tier the skyline never had.
 *
 * Terrain and imagery both degrade in three steps: packaged local tiles → a
 * remote provider → something flat but honest. Buildings had exactly one
 * source, Cesium Ion, and no token meant no skyline at all.
 *
 * This is the missing bottom tier, NOT a replacement. Order stays:
 *
 *   Ion tileset (token present)  ← today's fleet; the lit-window CustomShader
 *   packaged GeoJSON (this file) ← where the fleet currently shows nothing
 *   nothing                      ← unchanged
 *
 * That order is the whole fidelity argument. The Ion path's procedural window
 * lighting is the look the product was tuned around, and it keeps it. This
 * path only has to beat an EMPTY skyline, which is a much lower bar than
 * matching one — so it deliberately does not attempt per-window shading.
 *
 * Day/night needs no code here. PerInstanceColorAppearance with flat:false
 * takes Cesium's own sun lighting, so the mass darkens as the terminator
 * passes for free and stays consistent with the terrain it stands on. A
 * hand-rolled tint would mean per-frame per-instance attribute updates (and
 * giving up releaseGeometryInstances) to re-derive what the renderer already
 * computes correctly.
 *
 * The data (data/buildings/<city>.geojson, served by /api/buildings/:city) has
 * been sitting in the repo since May with no client consumer. ~600 footprints
 * and ~200 KB per city, from OSM under ODbL — licence-clean, unlike most of
 * what this product streams.
 */
import type * as CesiumType from 'cesium';
import { groundAltM } from '$content/locations';
import type { LocationId } from '$lib/types';
import { registerViewerTeardown } from './viewer-lifecycle';

/** A footprint ready to hand to Cesium: ring in degrees + the two altitudes. */
export interface BuildingExtrusion {
	/** Flattened [lon, lat, lon, lat, …] — Cesium's fromDegreesArray shape. */
	ring: number[];
	/** Base altitude in metres AMSL (city ground, exaggeration-corrected). */
	baseAltM: number;
	/** Roof altitude in metres AMSL. */
	topAltM: number;
}

/** Fallback when a footprint carries no usable height — a squat 2-3 storey block. */
const DEFAULT_HEIGHT_M = 9;

/** Ignore absurd values rather than letting one bad tag spear the sky. */
const MAX_HEIGHT_M = 830; // slightly above the Burj Khalifa

/**
 * GeoJSON FeatureCollection → extrusions, in metres AMSL.
 *
 * ─── THE GROUND OFFSET IS THE WHOLE POINT OF THIS FUNCTION ──────────────────
 * OSM `height` is height ABOVE THE GROUND, but Cesium extrudes from the
 * ellipsoid. Feeding the raw value in puts every building at sea level, which
 * looks merely a bit sunken in Hyderabad (~500 m) and buries Denver (~1600 m)
 * completely — the towers are entirely underground and the city reads as
 * empty. The failure is silent: no error, no warning, just no skyline, which
 * is indistinguishable from "the tier didn't load".
 *
 * `exaggeration` mirrors scene.verticalExaggeration, which scales TERRAIN but
 * not primitives. Any location tuned to something other than 1 would float or
 * sink its buildings relative to the ground they stand on unless the base
 * altitude is scaled to match.
 *
 * Pure and exported so both of those can be asserted without a GPU.
 */
export function extrusionsFromGeojson(
	geojson: unknown,
	locationId: LocationId,
	exaggeration = 1,
): BuildingExtrusion[] {
	const fc = geojson as { features?: unknown };
	if (!Array.isArray(fc?.features)) return [];

	const ground = groundAltM(locationId) * (Number.isFinite(exaggeration) ? exaggeration : 1);
	const out: BuildingExtrusion[] = [];

	for (const raw of fc.features) {
		const f = raw as {
			geometry?: { type?: string; coordinates?: unknown };
			properties?: { height?: unknown };
		};
		if (f?.geometry?.type !== 'Polygon') continue;
		const coords = f.geometry.coordinates;
		if (!Array.isArray(coords) || coords.length === 0) continue;

		// Outer ring only. Holes (courtyards) are dropped deliberately: at
		// cruise altitude a courtyard is sub-pixel, and PolygonHierarchy holes
		// cost triangulation on a Pi for something nobody can see.
		const outer = coords[0];
		if (!Array.isArray(outer) || outer.length < 3) continue;

		const ring: number[] = [];
		for (const pt of outer) {
			if (!Array.isArray(pt) || pt.length < 2) continue;
			const [lon, lat] = pt as number[];
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
			if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
			ring.push(lon, lat);
		}
		// Need 3 real vertices to make a face.
		if (ring.length < 6) continue;

		const h = f.properties?.height;
		const height =
			typeof h === 'number' && Number.isFinite(h) && h > 0
				? Math.min(h, MAX_HEIGHT_M)
				: DEFAULT_HEIGHT_M;

		out.push({ ring, baseAltM: ground, topAltM: ground + height });
	}
	return out;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * One cached primitive per city.
 *
 * Never destroyed once built. The kiosk visits eight fixed locations forever,
 * and the operator explicitly asked that buildings stop vanishing mid-flight —
 * the Ion path solves that with a large tile cache, this path solves it by
 * simply keeping the geometry. Eight cities of ~600 footprints is a trivial
 * amount of GPU memory next to the tile caches already held.
 */
const _cityPrimitives = new Map<LocationId, CesiumType.Primitive>();

/** In-flight loads, so a rapid hop sequence can't request the same city twice. */
const _inFlight = new Map<LocationId, Promise<void>>();

/** True when this tier has anything to show for `id`. */
export function hasOfflineBuildings(id: LocationId): boolean {
	return _cityPrimitives.has(id);
}

/**
 * Drop all cached primitives. MUST be called from initBuildings on every
 * viewer (re)mount.
 *
 * Not a test seam — a lifecycle requirement, and the same one that already
 * bit the tileset, the imagery layers and the EpsilonGates. This map is a
 * module singleton but the VIEWER is not: on remount (Cesium auto-retry, HMR,
 * page nav) every cached Primitive still belongs to the DESTROYED scene, while
 * hasOfflineBuildings() keeps reporting the city as loaded. loadOfflineCity
 * then early-returns, nothing is ever added to the new scene, and the skyline
 * is gone until a full reload.
 *
 * Clearing is enough: viewer.destroy() takes its own primitives with it, so
 * there is nothing here to dispose separately.
 */
export function resetOfflineBuildings(): void {
	_cityPrimitives.clear();
	_inFlight.clear();
}

/**
 * Fetch + build the primitive for one city. Idempotent and cached.
 *
 * Failure is quiet by design: this tier exists because something upstream was
 * already unavailable, so a 404 here means "still no buildings", which is
 * exactly the state we were in before. Never break the fiction with an error.
 */
export async function loadOfflineCity(
	C: typeof CesiumType,
	viewer: CesiumType.Viewer,
	locationId: LocationId,
	exaggeration = 1,
): Promise<void> {
	if (_cityPrimitives.has(locationId)) return;
	const existing = _inFlight.get(locationId);
	if (existing) return existing;

	const job = (async () => {
		try {
			const res = await fetch(`/api/buildings/${locationId}`);
			if (!res.ok) return;
			const extrusions = extrusionsFromGeojson(await res.json(), locationId, exaggeration);
			if (extrusions.length === 0) return;

			const instances = extrusions.map(
				(e) =>
					new C.GeometryInstance({
						geometry: new C.PolygonGeometry({
							polygonHierarchy: new C.PolygonHierarchy(
								C.Cartesian3.fromDegreesArray(e.ring),
							),
							height: e.baseAltM,
							extrudedHeight: e.topAltM,
							// Flat shading per face — cheaper than smooth normals
							// and correct for boxes, which is all these are.
							vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
						}),
						attributes: {
							color: C.ColorGeometryInstanceAttribute.fromColor(
								C.Color.fromCssColorString('#6b6f76'),
							),
						},
					}),
			);

			// ONE primitive for the whole city — 600 separate entities would be
			// 600 draw calls, which is the difference between this being free
			// and this being the reason the Pi drops frames.
			const primitive = new C.Primitive({
				geometryInstances: instances,
				appearance: new C.PerInstanceColorAppearance({ flat: false, translucent: false }),
				// The kiosk never picks buildings; skipping the pick pass saves
				// a full extra render of this geometry every frame.
				allowPicking: false,
				// Build once, then leave it alone.
				releaseGeometryInstances: true,
				asynchronous: true,
			});
			primitive.show = false;
			viewer.scene.primitives.add(primitive);
			_cityPrimitives.set(locationId, primitive);
		} catch {
			// Offline, malformed JSON, or no packaged data — stay silent.
		} finally {
			_inFlight.delete(locationId);
		}
	})();

	_inFlight.set(locationId, job);
	return job;
}

/**
 * Show exactly the requested city, hide the rest. Cheap enough to call every
 * frame; does no work when nothing changed.
 */
export function showOfflineCity(locationId: LocationId | null, enabled: boolean): void {
	for (const [id, prim] of _cityPrimitives) {
		const want = enabled && id === locationId;
		if (prim.show !== want) prim.show = want;
	}
}

// The omission that prompted the whole contract: this cache belonged to
// neither teardown convention, so nothing ever cleared it.
registerViewerTeardown('buildings-geojson', resetOfflineBuildings);
