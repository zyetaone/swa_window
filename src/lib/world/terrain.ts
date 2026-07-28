/**
 * Terrain — Cesium terrain provider + exaggeration sync.
 *
 * Call lifecycle:
 *   initTerrain(Cesium, viewer) — once, stores refs
 *   setupTerrain()              — once, async, creates provider
 *   syncTerrain(exaggeration)   — per-tick, idempotent via EpsilonGate
 */

import type * as CesiumType from 'cesium';
import { getIonToken, checkLocalTileServer, TILE_SERVER_URL } from './cesium-setup';
import { EpsilonGate } from './util';

type C = typeof CesiumType;

let _cs: C;
let _viewer: CesiumType.Viewer;
const _exaggeration = new EpsilonGate<number>(0.01, -1);

export function initTerrain(Cesium: C, viewer: CesiumType.Viewer): void {
	_cs = Cesium;
	_viewer = viewer;
}

export async function setupTerrain(): Promise<void> {
	const C = _cs;
	const v = _viewer;
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

export function syncTerrain(exaggeration: number): void {
	_exaggeration.update(exaggeration, (val) => { _viewer.scene.verticalExaggeration = val; });
}
