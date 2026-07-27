/**
 * world/model — Cesium quality presets + type contracts (MRAX: Model layer).
 *
 * Framework-free config data. Zero Cesium runtime dependency beyond `import type`.
 */
import type { QualityMode } from '$lib/types';

export interface CesiumQualityPreset {
	maximumScreenSpaceError: number;
	tileCacheSize: number;
	preloadSiblings: boolean;
	preloadAncestors: boolean;
	loadingDescendantLimit: number;
}

export const CESIUM_QUALITY_PRESETS: Record<QualityMode, CesiumQualityPreset> = {
	performance: {
		maximumScreenSpaceError: 8,
		tileCacheSize: 50,
		preloadSiblings: false,
		preloadAncestors: true,
		loadingDescendantLimit: 4,
	},
	balanced: {
		maximumScreenSpaceError: 5,
		tileCacheSize: 100,
		preloadSiblings: true,
		preloadAncestors: true,
		loadingDescendantLimit: 6,
	},
	ultra: {
		maximumScreenSpaceError: 2,
		tileCacheSize: 200,
		preloadSiblings: true,
		preloadAncestors: true,
		loadingDescendantLimit: 8,
	},
};
