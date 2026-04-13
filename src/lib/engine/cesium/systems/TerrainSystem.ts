import type * as CesiumType from 'cesium';
import { CESIUM_QUALITY_PRESETS } from '$lib/shared/constants';
import type { QualityMode } from '$lib/shared/constants';

const TILE_SERVER_URL =
	(typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TILE_SERVER_URL) || null;

export class TerrainSystem {
	private readonly viewer: CesiumType.Viewer;
	private readonly C: typeof CesiumType;

	constructor(viewer: CesiumType.Viewer, C: typeof CesiumType) {
		this.viewer = viewer;
		this.C = C;
	}

	async setup(): Promise<void> {
		const useLocal = await this.checkTileServer();

		if (useLocal) {
			await this.setupLocal();
		} else if (this.checkIonToken()) {
			await this.setupIon();
		} else {
			await this.setupFreeTerrain();
		}
	}

	private async checkTileServer(): Promise<boolean> {
		if (!TILE_SERVER_URL) return false;
		try {
			const resp = await fetch(`${TILE_SERVER_URL}/health`, { signal: AbortSignal.timeout(500) });
			return resp.ok;
		} catch { return false; }
	}

	private checkIonToken(): boolean {
		const token = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN;
		return !!(token && token !== 'your-cesium-ion-token-here');
	}

	private async setupIon(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.createWorldTerrainAsync({
				requestVertexNormals: true,
				requestWaterMask: true,
			});
		} catch (e) {
			console.warn('[CesiumTerrain] Ion terrain failed, falling back to free terrain:', e);
			await this.setupFreeTerrain();
		}
	}

	private async setupFreeTerrain(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
				'https://s3.us-west-2.amazonaws.com/elevation-tiles-prod/terrarium',
				{ requestVertexNormals: false, requestWaterMask: false },
			);
		} catch (e) {
			console.warn('[CesiumTerrain] Free terrain unavailable, using ellipsoid:', e);
			this.viewer.terrainProvider = new C.EllipsoidTerrainProvider();
		}
	}

	private async setupLocal(): Promise<void> {
		const C = this.C;
		try {
			this.viewer.terrainProvider = await C.CesiumTerrainProvider.fromUrl(
				`${TILE_SERVER_URL}/terrain`,
				{ requestVertexNormals: true, requestWaterMask: true },
			);
		} catch (e) {
			console.warn('[CesiumTerrain] Local terrain failed, falling back to Ion:', e);
			await this.setupIon();
		}
	}

	applyQualityMode(mode: QualityMode): void {
		const globe = this.viewer.scene.globe;
		const p = CESIUM_QUALITY_PRESETS[mode];
		globe.maximumScreenSpaceError = p.maximumScreenSpaceError;
		globe.tileCacheSize = p.tileCacheSize;
		globe.preloadSiblings = p.preloadSiblings;
		globe.preloadAncestors = p.preloadAncestors;
		globe.loadingDescendantLimit = p.loadingDescendantLimit;
	}
}
