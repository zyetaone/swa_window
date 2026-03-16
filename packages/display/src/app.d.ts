// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type * as CesiumType from 'cesium';

/** Persists Cesium viewer across Vite HMR reloads */
interface CesiumHMRCache {
	viewer: CesiumType.Viewer | null;
	Cesium: typeof CesiumType | null;
	initialized: boolean;
	nightLayer: CesiumType.ImageryLayer | null;
	buildingsTileset: CesiumType.Cesium3DTileset | null;
	google3DTileset: CesiumType.Cesium3DTileset | null;
	roadLightLayer: CesiumType.ImageryLayer | null;
}

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// eslint-disable-next-line no-var
	var __CESIUM_HMR_CACHE__: CesiumHMRCache | undefined;
}

export {};
