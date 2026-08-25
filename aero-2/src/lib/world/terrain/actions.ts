/**
 * Terrain detail, applied to Cesium: the mesh provider, and how finely the
 * globe is tessellated.
 */
import type { GlobeRuntime, Subsystem, RenderFrame } from '#lib/cesium/types.js';
import { EpsilonGate } from '#lib/cesium/gate.js';
import { screenSpaceErrorFor } from '#lib/world/terrain/rules.js';
import { tileCache, tileServerBase } from '#lib/cesium/tiles.svelte.js';
import { createTerrariumProvider } from '#lib/world/terrain/terrarium.js';

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

export type TerrainMode = 'ellipsoid' | 'mesh' | 'terrarium';

/**
 * Local quantized-mesh pack if we shipped one; else terrarium heightmaps if the
 * tile server can actually produce them — from a pack on disk, or by proxy when
 * the deployment opted into that; else a smooth ellipsoid. Never a hard failure:
 * the fiction survives a flat planet, it does not survive a stack trace.
 *
 * This used to ask `navigator.onLine`, which is true on a LAN with no route out.
 * That picked terrarium and then failed every single tile. The tile server knows
 * the real answer, so it is asked instead.
 */
function terrariumReachable(): boolean {
	return tileCache.layerAvailable('terrarium') || tileCache.remoteFallback;
}

function targetMode(): TerrainMode {
	if (tileCache.layerAvailable('cesium-terrain')) return 'mesh';
	if (terrariumReachable()) return 'terrarium';
	return 'ellipsoid';
}

export class TerrainSync implements Subsystem {
	/** Plain field: nothing subscribes to this, only #apply and one test read it. */
	appliedMode: TerrainMode | null = null;
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
		const target = targetMode();
		if (this.appliedMode === target) return;
		void this.#apply(rt);
	}

	reset(): void {
		this.appliedMode = null;
		this.#ready = false;
	}

	async #apply(rt: GlobeRuntime): Promise<void> {
		const target = targetMode();
		if (this.appliedMode === target) return;

		if (target === 'terrarium') {
			try {
				rt.viewer.terrainProvider = createTerrariumProvider(
					rt.Cesium
				) as unknown as import('cesium').TerrainProvider;
				this.appliedMode = 'terrarium';
				return;
			} catch (e) {
				console.warn('[TerrainSync] terrarium failed, using ellipsoid:', e);
			}
		}

		if (target === 'mesh') {
			try {
				rt.viewer.terrainProvider = await rt.Cesium.CesiumTerrainProvider.fromUrl(
					`${tileServerBase()}/cesium-terrain`
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
