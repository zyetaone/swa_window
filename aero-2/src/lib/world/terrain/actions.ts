/**
 * Terrain detail, applied to Cesium: the mesh provider, and how finely the
 * globe is tessellated.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/cesium/types.js';
import { EpsilonGate } from '#lib/cesium/gate.js';
import { screenSpaceErrorFor } from '#lib/world/terrain/rules.js';
import { tileCache, tileServerBase } from '#lib/cesium/tiles.svelte.js';

const SSE_HYSTERESIS = 2;

export class LodSync implements Subsystem {
	readonly #gate = new EpsilonGate(SSE_HYSTERESIS);

	sync(rt: GlobeRuntime, frame: RenderFrame): void {
		const target = screenSpaceErrorFor(frame.atmosphere.groundDetail);
		if (!this.#gate.changed(target)) return;
		rt.viewer.scene.globe.maximumScreenSpaceError = target;
	}

	reset(): void {
		this.#gate.reset();
	}
}

export class TerrainSync implements Subsystem {
	/** Plain field: nothing subscribes to this, only #apply and one test read it. */
	appliedMode: 'ellipsoid' | 'mesh' | null = null;
	#ready = false;

	async setup(rt: GlobeRuntime): Promise<void> {
		this.appliedMode = null;
		this.#ready = true;
		await this.#apply(rt);
	}

	sync(rt: GlobeRuntime, _frame: RenderFrame): void {
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
