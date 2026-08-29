import type * as CesiumType from 'cesium';
import type { CameraView } from '../../flight/view.js';
import { resolveClearance, type Clearance } from '../clearance.js';

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
	const clearance: Clearance = resolveClearance(
		groundElevationM || 0,
		viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(v.lon, v.lat))
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
