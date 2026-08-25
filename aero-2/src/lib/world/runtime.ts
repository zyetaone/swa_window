/**
 * The live Cesium viewer and everything whose lifetime is tied to it.
 *
 * Runtime handle and per-frame fan-out are one object because they are one
 * lifetime: both were opened in globe.ts's async body and closed in its
 * teardown, and neither was ever useful without the other. Keeping them apart
 * bought nothing and created an ordering question — clear-then-destroy or
 * destroy-then-clear — that had no right answer and could only be got wrong.
 */
import type { GlobeSyncSlice } from '#lib/types.js';
import { createCameraSyncScratch, syncCamera, type CameraSyncScratch } from '#lib/world/sync-camera.js';
import { syncAtmosphere } from '#lib/world/sync-atmosphere.js';
import { LodSync } from '#lib/world/sync-lod.js';
import { ImagerySync } from '#lib/world/sync-imagery.svelte.js';

type CesiumModule = typeof import('cesium');
type Viewer = import('cesium').Viewer;

/** Cesium plus the viewer it built — the pair every sync function needs. */
export class GlobeRuntime {
	constructor(
		readonly Cesium: CesiumModule,
		readonly viewer: Viewer,
	) {}
}

export class WorldRuntime {
	#runtime: GlobeRuntime | null = null;
	#cameraScratch: CameraSyncScratch | null = null;
	readonly #lod = new LodSync();
	readonly #imagery = new ImagerySync();

	/**
	 * Async because imagery has to probe the tile server before it can decide
	 * whether local tiles exist at all. sync() no-ops until this resolves.
	 */
	async open(Cesium: CesiumModule, viewer: Viewer): Promise<void> {
		const rt = new GlobeRuntime(Cesium, viewer);
		this.#runtime = rt;
		this.#cameraScratch = createCameraSyncScratch(Cesium);
		if (import.meta.env.DEV) {
			(globalThis as Record<string, unknown>).__viewer = viewer;
		}
		await this.#imagery.setup(rt);
	}

	close(): void {
		this.#runtime = null;
		this.#cameraScratch = null;
		this.#lod.reset();
		this.#imagery.reset();
	}

	/** Per-frame fan-out. No-op before open() — the model ticks before mount. */
	sync(slice: GlobeSyncSlice): void {
		const rt = this.#runtime;
		if (!rt || !this.#cameraScratch) return;
		syncCamera(rt, slice.camera, this.#cameraScratch);
		syncAtmosphere(rt, slice.atmosphere);
		this.#lod.sync(rt, slice.atmosphere);
		this.#imagery.sync(rt, slice.imagery);
	}
}

/** Process singleton — the Single-Viewer Rule, expressed as one instance. */
export const worldRuntime = new WorldRuntime();
