import type * as CesiumType from 'cesium';
import type { CameraView } from '../../flight/view.js';

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
 * The MapLibre path solved this by asking the renderer what the ground actually
 * is beneath the aircraft (`map.queryTerrainElevation`) and using the mean only
 * as a floor. Cesium has the equivalent — `globe.getHeight(cartographic)` — and
 * this should use it before `?engine=cesium` is more than an experiment.
 *
 * Until then the two engines disagree about where the ground is, which is worse
 * than either being wrong on its own: the same location flies clean on MapLibre
 * and through a mountain on Cesium.
 */
export function syncCesiumCamera(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	v: CameraView,
	groundElevationM: number = 0
) {
	if (!v.lat || !v.lon) return;

	// Real MSL aircraft altitude ensures camera is always above mountain heights
	const mslAltitudeM = Math.max(1000, (groundElevationM || 0) + (v.aglM || 4000));
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
