/**
 * world/camera — typed camera state for cross-boundary readers.
 *
 * Three-side consumers (CameraMirror, any future cloud/wing layer that
 * needs to mirror the camera) MUST go through this module rather than
 * reaching into Cesium types or `activeCesium.manager.getCameraRead()`.
 *
 * `getCameraRead()` returns a plain `{x,y,z}` shape — no Cesium types
 * cross the world boundary. Returns `null` if no Cesium viewer is
 * mounted (page is in transition, manager not yet published).
 *
 * H6 / Phase 3 follow-up: this is the typed surface AGENTS.md documents.
 * Previously CameraMirror reached into `activeCesium.manager` directly
 * and typed its `mgr` slot as `CesiumManager`, leaking the orchestrator
 * class shape across the world boundary. With this module in place the
 * Three side only needs to know the return shape.
 */
import { activeCesium } from './active.svelte';

export interface CameraRead {
	position: { x: number; y: number; z: number };
	direction: { x: number; y: number; z: number };
	up: { x: number; y: number; z: number };
	fovDeg: number;
}

/**
 * Read the current Cesium camera as plain numbers. Null when no viewer
 * is mounted (page navigation, HMR, auto-retry).
 */
export function getCameraRead(): CameraRead | null {
	const mgr = activeCesium.manager;
	if (!mgr) return null;
	return mgr.getCameraRead();
}
