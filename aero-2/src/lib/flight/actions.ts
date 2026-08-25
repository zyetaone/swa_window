/**
 * Puts the camera where the flight says it is. The only subsystem that runs
 * every frame unconditionally — the pose changes every frame.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/cesium/types.js';

export class CameraSync implements Subsystem {
	#scratch: import('cesium').Cartesian3 | null = null;

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		const { Cesium, viewer } = rt;
		const camera = frame.camera;
		this.#scratch ??= new Cesium.Cartesian3();
		Cesium.Cartesian3.fromDegrees(
			camera.lon,
			camera.lat,
			camera.altitudeM,
			Cesium.Ellipsoid.WGS84,
			this.#scratch
		);
		viewer.camera.setView({
			destination: this.#scratch,
			orientation: {
				heading: Cesium.Math.toRadians(camera.headingDeg),
				pitch: Cesium.Math.toRadians(camera.pitchDeg),
				roll: 0
			}
		});
	}

	reset(): void {
		this.#scratch = null;
	}
}
