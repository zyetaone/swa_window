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
 * So it asks the globe, exactly as `Stage.svelte` asks the map: the mean is the
 * FLOOR, the sampled terrain height wins when it is higher, and `getHeight`
 * returning undefined (tile not loaded yet) falls back to the mean rather than
 * to zero -- a not-yet-loaded tile must never be able to drop the camera.
 *
 * Both engines now derive clearance the same way, which is the point. The same
 * location flying clean on MapLibre and through a mountain on Cesium was worse
 * than either being wrong on its own.
 */
export function syncCesiumCamera(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	v: CameraView,
	groundElevationM: number = 0
) {
	if (!v.lat || !v.lon) return;

	const meanGroundM = groundElevationM || 0;
	const sampled = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(v.lon, v.lat));
	// `getHeight` is undefined until the terrain tile under this point loads.
	const groundM = Math.max(
		meanGroundM,
		Number.isFinite(sampled as number) ? (sampled as number) : meanGroundM
	);

	const mslAltitudeM = Math.max(1000, groundM + (v.aglM || 4000));
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
