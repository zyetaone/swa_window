/**
 * Public surface of the palettes content module.
 *
 *   import { SKY_PALETTE } from '$content/palettes';
 *
 * `city-lights` and `car-lights` used to live here too. Their consumers
 * (CityGlowDome, OsmRoads, the Cesium car-lights geo-effect) were deleted in
 * the Three-overlay and DOM-compositor sweeps, leaving palettes that nothing
 * read — a "single source of truth" with no downstream, which is worse than
 * no file at all because it still looks authoritative. Recover from git
 * history if those layers return.
 */

export { SKY_PALETTE, type SkyPaletteEntry } from './sky';
