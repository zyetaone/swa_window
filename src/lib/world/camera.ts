/**
 * camera — Cesium camera position/orientation sync.
 *
 * Reactive feature: per-frame sync reads from a flat `CameraSlice`
 * (the flight engine's smoothed pose + the camera config) and pushes
 * the result into `viewer.camera.setView({...})`.
 *
 * The `_scratchDest` Cartesian3 is module-private and reused across
 * frames to avoid per-tick allocation. This is the only allocation
 * optimisation preserved from the old class-based `CameraManager`.
 *
 * The "passenger seat-look" frame constant (90° off nose) lives here:
 * the camera looks SEAT_LOOK_DEG off the aircraft heading to face out
 * the side window, matching the cabin metaphor.
 */

import { activeCesium } from './active.svelte';

const SEAT_LOOK_DEG = 90;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _scratchDest: any = null;

export interface CameraConfigSlice {
	readonly effectiveHeading: (baseHeading: number) => number;
	readonly motion: { bankPitchCouple: number };
	readonly flyoverPitchDeg: number;
}

export interface FlightPoseSlice {
	readonly camLon: number;
	readonly camLat: number;
	/** Camera altitude in feet — converted to metres before Cesium call. */
	readonly camAlt: number;
	readonly camPitch: number;
	readonly camHeading: number;
}

export interface MotionSlice {
	readonly bankAngle: number;
}

export interface CameraSlice {
	flight: FlightPoseSlice;
	motion: MotionSlice;
	config: { camera: CameraConfigSlice };
}

/**
 * One-time setup: pre-allocate the scratch Cartesian3. Idempotent.
 */
export function setupCamera(): void {
	if (_scratchDest) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const C = mgr.getCesium();
	_scratchDest = new C.Cartesian3();
}

/**
 * Per-frame camera sync. Computes parallax heading, projects
 * (camLon, camLat, camAlt) into the scratch Cartesian3, applies
 * bank-pitch coupling + optional flyover override, then calls
 * `viewer.camera.setView({...})`.
 */
export function syncCamera(slice: CameraSlice): void {
	if (!_scratchDest) return;
	const mgr = activeCesium.manager;
	if (!mgr) return;
	const viewer = mgr.getViewer();
	const C = mgr.getCesium();

	const f = slice.flight;
	const parallaxHeading = slice.config.camera.effectiveHeading(f.camHeading);
	// Feet → metres for Cesium ECEF.
	C.Cartesian3.fromDegrees(f.camLon, f.camLat, f.camAlt * 0.3048, undefined, _scratchDest);

	const bankPitchCouple = slice.config.camera.motion.bankPitchCouple ?? 0;
	const flyover = slice.config.camera.flyoverPitchDeg ?? 0;
	const pitchDeg = flyover !== 0
		? flyover - bankPitchCouple * slice.motion.bankAngle
		: (f.camPitch - 90) - bankPitchCouple * slice.motion.bankAngle;

	viewer.camera.setView({
		destination: _scratchDest,
		orientation: {
			heading: C.Math.toRadians((parallaxHeading + SEAT_LOOK_DEG) % 360),
			pitch: C.Math.toRadians(pitchDeg),
			roll: C.Math.toRadians(-slice.motion.bankAngle),
		},
	});
}

/**
 * Camera state in a project-frame-friendly shape. CameraMirror (and
 * any other system that needs to mirror Cesium's camera each frame)
 * reads through this instead of reaching into `viewer.camera.positionWC`
 * directly. Plain `{x,y,z}` objects + a scalar fov, no Cesium types.
 */
export interface CameraRead {
	position: { x: number; y: number; z: number };
	direction: { x: number; y: number; z: number };
	up: { x: number; y: number; z: number };
	fovDeg: number;
}

export function getCameraRead(): CameraRead | null {
	const mgr = activeCesium.manager;
	if (!mgr) return null;
	const cam = mgr.getViewer().camera;
	const p = cam.positionWC;
	const d = cam.directionWC;
	const u = cam.upWC;
	const fovy = (cam.frustum as { fovy: number }).fovy;
	return {
		position: { x: p.x, y: p.y, z: p.z },
		direction: { x: d.x, y: d.y, z: d.z },
		up: { x: u.x, y: u.y, z: u.z },
		fovDeg: Number.isFinite(fovy) ? (fovy * 180) / Math.PI : NaN,
	};
}
