/**
 * Real heightmaps when the pack ships quantized-mesh, ellipsoid otherwise.
 */
import type { GlobeRuntime, Subsystem, WorldFrame } from '#lib/world/contract.js';
import { tileCache, tileServerBase } from '#lib/world/tiles.svelte.js';

export class TerrainSync implements Subsystem {
	/** Plain field: nothing subscribes to this, only #apply and one test read it. */
	appliedMode: 'ellipsoid' | 'mesh' | null = null;
	#ready = false;

	async setup(rt: GlobeRuntime): Promise<void> {
		this.appliedMode = null;
		this.#ready = true;
		await this.#apply(rt);
	}

	sync(rt: GlobeRuntime, _frame: WorldFrame): void {
		if (!this.#ready) return;
		// Cheap guard before the async call — otherwise this allocates a promise
		// 60x a second only to early-return inside it.
		const target = tileCache.layerAvailable('cesium-terrain') ? 'mesh' : 'ellipsoid';
		if (this.appliedMode === target) return;
		void this.#apply(rt);
	}

	reset(): void {
		this.appliedMode = null;
		this.#ready = false;
	}

	async #apply(rt: GlobeRuntime): Promise<void> {
		const wantMesh = tileCache.layerAvailable('cesium-terrain');
		const targetMode: 'ellipsoid' | 'mesh' = wantMesh ? 'mesh' : 'ellipsoid';
		if (this.appliedMode === targetMode) return;

		if (targetMode === 'mesh') {
			try {
				rt.viewer.terrainProvider = await rt.Cesium.CesiumTerrainProvider.fromUrl(
					`${tileServerBase()}/cesium-terrain`,
				);
				this.appliedMode = 'mesh';
				return;
			} catch (e) {
				console.warn('[TerrainSync] local mesh failed, using ellipsoid:', e);
			}
		}

		rt.viewer.terrainProvider = new rt.Cesium.EllipsoidTerrainProvider();
		this.appliedMode = 'ellipsoid';
	}
}
