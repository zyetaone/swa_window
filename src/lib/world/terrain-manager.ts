/**
 * TerrainManager — Cesium terrain provider + exaggeration sync.
 */

import type * as CesiumType from 'cesium';
import { getIonToken, checkLocalTileServer, TILE_SERVER_URL } from './cesium-setup';

type C = typeof CesiumType;

export class TerrainManager {
	readonly #C: C;
	readonly #viewer: CesiumType.Viewer;
	#lastExaggeration = -1;

	constructor(Cesium: C, viewer: CesiumType.Viewer) {
		this.#C = Cesium;
		this.#viewer = viewer;
	}

	async setup(): Promise<void> {
		const C = this.#C;
		const v = this.#viewer;
		if (await checkLocalTileServer()) {
			try {
				v.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
					`${TILE_SERVER_URL}/cesium-terrain`,
					{ requestVertexNormals: true, requestWaterMask: true },
				);
				return;
			} catch (e) { console.warn('[Terrain] Local failed, trying Ion:', e); }
		}
		if (getIonToken()) {
			try {
				v.terrainProvider = await C.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
				return;
			} catch (e) { console.warn('[Terrain] Ion failed, using ellipsoid:', e); }
		}
		console.warn('[Terrain] No cache/token — flat ellipsoid');
		v.terrainProvider = new C.EllipsoidTerrainProvider();
	}

	sync(exaggeration: number): void {
		if (Math.abs(exaggeration - this.#lastExaggeration) > 0.01) {
			this.#lastExaggeration = exaggeration;
			this.#viewer.scene.verticalExaggeration = exaggeration;
		}
	}
}
