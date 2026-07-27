/**
 * CameraManager — owns the Cesium camera + the (camLon,camLat,camAlt) →
 * Cartesian3 + bank/pitch/flyover orientation translation.
 *
 * Per-frame sync: read `model.flight.cam*`, project to destination,
 * apply parallax-aware heading, bank-pitch coupling, and (optional)
 * flyover override. The scratch Cartesian3 is reused across frames to
 * avoid per-tick allocation.
 *
 * Also mirrors Cesium's `requestRenderMode` state: tick() ends with
 * `scene.requestRender()` (called by the orchestrator) so the camera
 * change drives a re-render.
 */

import type * as CesiumType from 'cesium';

type C = typeof CesiumType;

export interface CameraSlice {
	flight: {
		camLat: number;
		camLon: number;
		camAlt: number; // feet
		camPitch: number;
		camHeading: number;
	};
	motion: { bankAngle: number };
	config: {
		camera: {
			effectiveHeading(baseHeading: number): number;
			motion: { bankPitchCouple: number };
			flyoverPitchDeg: number;
		};
	};
}

const SEAT_LOOK_DEG = 90;

export class CameraManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#scratchDest: any = null;

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	setup(): void {
		this.#scratchDest = new this.#C.Cartesian3();
	}

	sync(slice: CameraSlice): void {
		const f = slice.flight;
		const C = this.#C;

		const parallaxHeading = slice.config.camera.effectiveHeading(f.camHeading);
		C.Cartesian3.fromDegrees(f.camLon, f.camLat, f.camAlt * 0.3048, undefined, this.#scratchDest);

		const bankPitchCouple = slice.config.camera.motion.bankPitchCouple ?? 0;
		const flyover = slice.config.camera.flyoverPitchDeg ?? 0;
		const pitchDeg = flyover !== 0
			? flyover - bankPitchCouple * slice.motion.bankAngle
			: (f.camPitch - 90) - bankPitchCouple * slice.motion.bankAngle;

		this.#viewer.camera.setView({
			destination: this.#scratchDest,
			orientation: {
				heading: C.Math.toRadians((parallaxHeading + SEAT_LOOK_DEG) % 360),
				pitch: C.Math.toRadians(pitchDeg),
				roll: C.Math.toRadians(-slice.motion.bankAngle),
			},
		});
	}
}
