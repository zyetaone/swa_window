import type { Attachment } from 'svelte/attachments';

declare const CESIUM_BASE_URL: string;

/**
 * Tile-selection error, in pixels. The fielded Pis run the `performance`
 * preset, so this is the ship-path value — not a dev-only luxury setting.
 */
const MAX_SCREEN_SPACE_ERROR = 8;

/**
 * How much to relax tile-selection error with distance.
 *
 * An oblique window view sees to the horizon — ~357 km at 10 km altitude,
 * versus ~11 km looking straight down. The far field is therefore hundreds of
 * tiles resolving into a handful of pixels, while the near field is a handful
 * of tiles covering most of the screen. A single global error budget spends
 * most of itself where nothing is legible.
 *
 * Raising this coarsens distant tiles only, which is both free perceptually
 * and physically correct: air is not transparent for 357 km, so sharp horizon
 * detail was the artifact and haze is the correction. Cesium's default is 2.
 *
 * Calibration knob — the right value is whatever looks right on the wall at
 * cruise, and that can only be settled on real screens.
 */
const FOG_SSE_FACTOR = 16;

function ensureCesiumBaseUrl(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).CESIUM_BASE_URL ??= CESIUM_BASE_URL;
}

/**
 * Mounts a Cesium viewer on the attached element. Dynamic-imports Cesium so
 * the bundle defers until the element exists. Exactly one viewer per element;
 * cleanup is tied to DOM teardown via the attachment return.
 */
export function globe(token?: string): Attachment<HTMLElement> {
	return (element) => {
		ensureCesiumBaseUrl();

		let viewer: import('cesium').Viewer | null = null;
		let cancelled = false;

		void (async () => {
			const Cesium = await import('cesium');
			if (cancelled) return;

			if (token) Cesium.Ion.defaultAccessToken = token;

			viewer = new Cesium.Viewer(element, {
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

			// Distance-aware LOD. Fog must be enabled for screenSpaceErrorFactor
			// to apply at all — it is the fog distance that drives the relaxation.
			const { scene } = viewer;
			scene.globe.maximumScreenSpaceError = MAX_SCREEN_SPACE_ERROR;
			scene.fog.enabled = true;
			scene.fog.screenSpaceErrorFactor = FOG_SSE_FACTOR;

			// Hyderabad — shallow passenger pitch, not nadir.
			viewer.camera.setView({
				destination: Cesium.Cartesian3.fromDegrees(78.4867, 17.385, 10_000),
				orientation: {
					heading: Cesium.Math.toRadians(20),
					pitch: Cesium.Math.toRadians(-18),
					roll: 0,
				},
			});

			if (import.meta.env.DEV) {
				(globalThis as Record<string, unknown>).__viewer = viewer;
			}
		})();

		return () => {
			cancelled = true;
			viewer?.destroy();
			viewer = null;
		};
	};
}
