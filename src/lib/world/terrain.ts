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
	// See buildings/atmosphere/imagery: the gate outlives the viewer, so a
	// remount must force the next write through or exaggeration stays at the
	// new viewer's default.
	_exaggeration.reset();
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
	// NOTE: there is no free public quantized-mesh fallback to slot in here.
	// A previous attempt pointed at `cesium-terrain-cache.s3.amazonaws.com`,
	// which returns NoSuchBucket — it only added a failed round-trip to every
	// tokenless boot. ADR-002's answer is the PACKAGED tile cache above
	// (checkLocalTileServer), not a runtime third-party host. If a real
	// fallback is ever wanted, package Terrarium heightmaps via
	// tools/tile-packager and serve them from TILE_SERVER_URL.
	console.warn('[Terrain] No cache/token — flat ellipsoid');
	v.terrainProvider = new C.EllipsoidTerrainProvider();
}

export function syncTerrain(exaggeration: number): void {
	_exaggeration.update(exaggeration, (val) => { _viewer.scene.verticalExaggeration = val; });
}
