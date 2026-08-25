/**
 * Mounts Cesium into a DOM element and tears it down again.
 *
 * Knows nothing about what will be drawn: the caller is handed the viewer and
 * decides. That is what keeps this folder a pure adapter — swap the engine and
 * only this folder changes.
 */
import type { Attachment } from 'svelte/attachments';
import type { CesiumModule, CesiumScene, Viewer } from '#lib/cesium/types.js';

declare const CESIUM_BASE_URL: string;

/** One-time defaults. Per-frame appearance belongs to the subsystems. */
export function configureScene(scene: CesiumScene): void {
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
	timeline: false
} as const;

export interface GlobeHooks {
	token?: string;
	/** Called once the viewer exists. Whatever this returns is awaited. */
	open(Cesium: CesiumModule, viewer: Viewer, token?: string): Promise<void>;
	close(): void;
	onReady?(): void;
}

export function globe(hooks: GlobeHooks): Attachment<HTMLElement> {
	const { token } = hooks;
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
				terrainProvider: new Cesium.EllipsoidTerrainProvider()
			});
			viewer.cesiumWidget.creditContainer.remove();

			configureScene(viewer.scene);
			await hooks.open(Cesium, viewer, token);
			hooks.onReady?.();
		})();

		return () => {
			cancelled = true;
			hooks.close();
			viewer?.destroy();
			viewer = null;
		};
	};
}
