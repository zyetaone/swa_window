import type { CameraPose } from '#lib/types.js';
import type { GlobeRuntime } from '#lib/world/runtime.js';

export interface CameraSyncScratch {
	position: import('cesium').Cartesian3;
}

export function createCameraSyncScratch(Cesium: GlobeRuntime['Cesium']): CameraSyncScratch {
	return { position: new Cesium.Cartesian3() };
}

/** Per-frame camera pose — scratch Cartesian3 avoids per-frame alloc. */
export function syncCamera(
	rt: GlobeRuntime,
	camera: CameraPose,
	scratch: CameraSyncScratch,
): void {
	const { Cesium, viewer } = rt;
	Cesium.Cartesian3.fromDegrees(
		camera.lon,
		camera.lat,
		camera.altitudeM,
		Cesium.Ellipsoid.WGS84,
		scratch.position,
	);
	viewer.camera.setView({
		destination: scratch.position,
		orientation: {
			heading: Cesium.Math.toRadians(camera.headingDeg),
			pitch: Cesium.Math.toRadians(camera.pitchDeg),
			roll: 0,
		},
	});
}
