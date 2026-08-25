/**
 * Mounts Cesium into a DOM element and tears it down again — the Svelte edge of
 * the world layer.
 */
import type { Attachment } from 'svelte/attachments';
import type { Scene, Viewer } from '#lib/render/types.js';
import { SSE_GROUND } from '#lib/assets/data/imagery.js';
import { worldRuntime } from '#lib/render/runtime.svelte.js';

declare const CESIUM_BASE_URL: string;

/** One-time scene defaults. AtmosphereSync drives fog and sky colour per frame. */
export function configureScene(scene: Scene): void {
	scene.globe.maximumScreenSpaceError = SSE_GROUND;
	scene.globe.showGroundAtmosphere = false;
	scene.fog.enabled = true;
	if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
}

function ensureCesiumBaseUrl(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).CESIUM_BASE_URL ??= CESIUM_BASE_URL;
}

const KIOSK_WIDGETS_OFF = {
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
} as const;

export function globe(token?: string, onReady?: () => void): Attachment<HTMLElement> {
	return (element) => {
		ensureCesiumBaseUrl();

		let viewer: Viewer | null = null;
		let cancelled = false;

		void (async () => {
			const Cesium = await import('cesium');
			if (cancelled) return;

			if (token) Cesium.Ion.defaultAccessToken = token;

			viewer = new Cesium.Viewer(element, {
				...KIOSK_WIDGETS_OFF,
				baseLayer: false,
				skyBox: false,
				skyAtmosphere: false,
				terrainProvider: new Cesium.EllipsoidTerrainProvider(),
			});
			viewer.cesiumWidget.creditContainer.remove();

			configureScene(viewer.scene);
			await worldRuntime.open(Cesium, viewer, token);
			onReady?.();
		})();

		return () => {
			cancelled = true;
			worldRuntime.close();
			viewer?.destroy();
			viewer = null;
		};
	};
}
