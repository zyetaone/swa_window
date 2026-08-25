import type { Attachment } from 'svelte/attachments';
import type { GlobeSyncSlice } from '#lib/types.js';
import { worldRuntime } from '#lib/world/runtime.js';
import { setupLod } from '#lib/world/sync-lod.js';

declare const CESIUM_BASE_URL: string;

function ensureCesiumBaseUrl(): void {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).CESIUM_BASE_URL ??= CESIUM_BASE_URL;
}

/** Push a flat slice into the live viewer — no-op until globe attachment is ready. */
export function syncGlobe(slice: GlobeSyncSlice): void {
	worldRuntime.sync(slice);
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

/**
 * Mounts a Cesium viewer. Dynamic-imports Cesium so the bundle defers until
 * mount. Exactly one viewer per attachment; cleanup on DOM teardown.
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
				...KIOSK_WIDGETS_OFF,
				baseLayer: false,
				terrainProvider: new Cesium.EllipsoidTerrainProvider(),
			});
			viewer.cesiumWidget.creditContainer.remove();

			setupLod(viewer.scene);
			await worldRuntime.open(Cesium, viewer);
		})();

		return () => {
			cancelled = true;
			worldRuntime.close();
			viewer?.destroy();
			viewer = null;
		};
	};
}
