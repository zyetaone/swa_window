import type * as CesiumType from 'cesium';
import type { CameraView } from '../../flight/view.js';
import { resolveClearance } from '../clearance.js';

/**
 * Synchronize Cesium's WGS84 camera with the live CameraView pose.
 *
 * Altitude is MSL = ground + AGL, which is right in principle. But
 * `groundElevationM` here is the place's MEAN elevation — one number for a whole
 * region — and that is NOT enough to stay above terrain.
 *
 * Measured against the real terrarium DEM across each orbit (+-0.3 deg):
 *
 *   las_vegas  mean+floor 1520 m   real peak 3592 m   -> 2072 m INSIDE
 *   dubai      mean+floor  605 m   real peak 1724 m   -> 1119 m INSIDE
 *   mumbai     mean+floor  510 m   real peak 1500 m   ->  990 m INSIDE
 *
 * So it asks the globe, and both engines now run the same policy through
 * `resolveClearance`: the mean is the FLOOR, a real sample wins when higher,
 * and a tile that has not loaded falls back to the mean rather than to zero.
 *
 * CAVEAT, and it is the whole caveat: nothing in this repo ever configures a
 * terrain provider for Cesium, so the viewer runs the default
 * `EllipsoidTerrainProvider` -- a smooth ellipsoid with no mountains in it.
 * The numbers above therefore describe a mitigation this engine does NOT have.
 * `getHeight` still answers on an ellipsoid, with a perfectly finite 0, which
 * would have made the diagnostics counter read a confident 100% sampled while
 * measuring nothing at all. That is the exact failure this file's counter
 * exists to catch, so the ellipsoid is reported as UNSAMPLED and the regional
 * mean carries the camera, which is the honest description of what happens.
 * Give Cesium a real terrain provider and this becomes a live measurement
 * with no other change.
 *
 * NOTE the frames differ and that is correct, not drift. Cesium configures no
 * vertical exaggeration, so `globe.getHeight` is real metres MSL and the mean
 * is passed unscaled. MapLibre draws its mesh exaggerated and
 * `queryTerrainElevation` reports the DRAWN height, so Stage.svelte scales its
 * mean to match. Each caller converts to its own frame; the shared function
 * only decides which value wins.
 */
export function syncCesiumCamera(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	v: CameraView,
	groundElevationM: number = 0,
	/** Reports whether terrain answered, for the diagnostics counter. */
	onClearance?: (sampled: boolean) => void
) {
	if (!v.lat || !v.lon) return;

	// Real metres MSL on both sides: Cesium applies no vertical exaggeration.
	// An ellipsoid globe answers 0 everywhere; that is a default, not a reading.
	const hasTerrain = !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
	const clearance = resolveClearance(
		groundElevationM || 0,
		hasTerrain
			? viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(v.lon, v.lat))
			: undefined
	);
	onClearance?.(clearance.sampled);

	const mslAltitudeM = Math.max(1000, clearance.groundM + (v.aglM || 4000));
	const destination = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, mslAltitudeM);
	const heading = Cesium.Math.toRadians(v.cameraBearingDeg);
	const pitch = Cesium.Math.toRadians(Math.max(-85, Math.min(-5, v.cameraPitchDeg)));
	const roll = Cesium.Math.toRadians(-v.bankDeg);

	viewer.camera.setView({
		destination,
		orientation: {
			heading,
			pitch,
			roll
		}
	});
}
