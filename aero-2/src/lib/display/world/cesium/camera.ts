import type * as CesiumType from 'cesium';
import type { CameraView } from '../../flight/view.js';

/**
 * Synchronize Cesium WGS84 3D camera with the live CameraView mathematical pose.
 */
export function syncCesiumCamera(
	Cesium: typeof CesiumType,
	viewer: CesiumType.Viewer,
	v: CameraView
) {
	if (!v.lat || !v.lon) return;

	const destination = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, Math.max(400, v.aglM));
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
