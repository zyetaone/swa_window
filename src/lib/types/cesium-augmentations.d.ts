/**
 * Cesium Type Augmentations
 *
 * Extends Cesium types with properties that exist but aren't
 * included in the official TypeScript definitions.
 */

declare module 'cesium' {
	/**
	 * Extended properties for Cesium3DTileset
	 * These are runtime properties used by Cesium but not in official types
	 */
	interface Cesium3DTileset {
		/** Controls detail level - higher = less detail, better performance */
		maximumScreenSpaceError?: number;

		/** Skip level of detail for performance optimization */
		skipLevelOfDetail?: boolean;

		/** Prefer leaf nodes (highest detail) in progressive loading */
		preferLeaves?: boolean;

		/** Maximum memory usage in megabytes */
		maximumMemoryUsage?: number;
	}
}
