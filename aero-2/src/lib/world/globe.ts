import { Ion, Viewer, Cartesian3, Math as CesiumMath } from 'cesium';
import type { Attachment } from 'svelte/attachments';

// Cesium resolves its workers/assets against this global. `define` in
// vite.config.ts points it at the vite-plugin-static-copy output.
declare const CESIUM_BASE_URL: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).CESIUM_BASE_URL = CESIUM_BASE_URL;

/**
 * Mounts a Cesium viewer onto the attached element and tears it down when the
 * element leaves the DOM.
 *
 * This is the Single-Viewer Rule expressed as an attachment: exactly one
 * viewer per element, and the cleanup is structurally tied to the mount
 * rather than to a separately-registered teardown that could be forgotten.
 */
export function globe(token?: string): Attachment<HTMLElement> {
	return (element) => {
		if (token) Ion.defaultAccessToken = token;

		const viewer = new Viewer(element, {
			// Kiosk chrome: the window shows a world, not an app.
			animation: false,
			baseLayerPicker: false,
			fullscreenButton: false,
			geocoder: false,
			homeButton: false,
			infoBox: false,
			navigationHelpButton: false,
			sceneModePicker: false,
			selectionIndicator: false,
			timeline: false,
		});

		viewer.cesiumWidget.creditContainer.remove();

		// Hyderabad, roughly the fielded location.
		//
		// Orientation is NOT optional here. Cesium's default for setView is
		// nadir — straight down — which reads as a top-down map, not a window.
		// A passenger looks out and DOWN at a shallow angle, so pitch is a
		// modest negative and the horizon stays in frame.
		viewer.camera.setView({
			destination: Cartesian3.fromDegrees(78.4867, 17.385, 10_000),
			orientation: {
				heading: CesiumMath.toRadians(20),
				pitch: CesiumMath.toRadians(-18),
				roll: 0,
			},
		});

		// Dev-only handle. Screenshot capture from an automated tab throttles
		// rAF, so Cesium paints no frame and pixel captures come back black
		// even when the page renders fine for a human. State is verified
		// through this handle instead of through pixels.
		if (import.meta.env.DEV) {
			(globalThis as Record<string, unknown>).__viewer = viewer;
		}

		return () => viewer.destroy();
	};
}
