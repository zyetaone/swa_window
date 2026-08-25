import type { GlobeSyncSlice } from '#lib/types.js';
import type { GlobeRuntime } from '#lib/world/runtime.js';
import { createCameraSyncScratch, syncCamera, type CameraSyncScratch } from '#lib/world/sync-camera.js';
import { syncAtmosphere } from '#lib/world/sync-atmosphere.js';
import { LodSync } from '#lib/world/sync-lod.js';

/** Per-frame fan-out into world subsystems. */
export class GlobeSync {
	#cameraScratch: CameraSyncScratch | null = null;
	readonly #lod = new LodSync();

	init(Cesium: typeof import('cesium')): void {
		this.#cameraScratch = createCameraSyncScratch(Cesium);
	}

	destroy(): void {
		this.#cameraScratch = null;
		this.#lod.reset();
	}

	sync(rt: GlobeRuntime, slice: GlobeSyncSlice): void {
		if (!this.#cameraScratch) return;
		syncCamera(rt, slice.camera, this.#cameraScratch);
		syncAtmosphere(rt, slice.atmosphere);
		this.#lod.sync(rt, slice.atmosphere);
	}
}

export const globeSync = new GlobeSync();
