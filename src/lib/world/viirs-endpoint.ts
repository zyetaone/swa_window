/**
 * NASA GIBS night-lights WMTS endpoint — THE single copy.
 *
 * Consumed by BOTH renderers: world/compose.ts (Cesium night-lights imagery
 * layer, `{z}/{y}/{x}` UrlTemplate tokens) and world/viirs-field.ts (per-tile
 * canvas sampling that drives the bokeh carpet, neon roads, building window
 * density and the city glow dome). Framework-free on purpose. The host
 * already moved once — the old map1.vis.earthdata.nasa.gov/wmts-webmerc now
 * returns InvalidParameter — and had to be fixed in two places, hence SSOT.
 *
 * ── Why NOT VIIRS_Black_Marble ──────────────────────────────────────────
 * Black Marble is a COLORIZED product: amber cities painted over a lifted
 * navy background. Measured at z8, its Sahara tile is a flat fill — median
 * 36/255, 99th percentile 38/255, not one pixel below 8. That background is
 * ~0.14 luminance, which sits ABOVE CityLightField's 0.12 "this is truly
 * dark" floor, so empty desert and open ocean cleared the floor and grew
 * bokeh dots and skyglow. Its colour was wasted as well: compose.ts sets
 * saturation = 0 and re-tints downstream, so the pipeline threw away the
 * amber it paid to download and fought the source at both ends.
 *
 * ── Why THIS layer ──────────────────────────────────────────────────────
 * Gap-Filled BRDF-Corrected Day/Night Band radiance (VNP46A2-class) is a
 * greyscale RADIANCE product: moonlight and stray light removed, cloud gaps
 * BRDF-filled. Same z8 ceiling — every GIBS night layer is capped at
 * GoogleMapsCompatible_Level8, so no layer choice buys resolution — but the
 * background is honestly black. Measured on the pinned date below: 100% of
 * the Sahara tile and 94% of the mid-Pacific tile fall under the 0.12 floor,
 * while Hyderabad's median is 77/255. Greyscale in makes saturation = 0 a
 * no-op rather than a repair, and the data is current rather than a 2016
 * composite predating a decade of Indian urban growth.
 *
 * ── Why a PINNED date ───────────────────────────────────────────────────
 * This layer is daily (2018-01-05 onward). A floating date would break
 * invariant #4: three Pis booting either side of midnight UTC would fetch
 * different rasters, and their bokeh, neon and window density would disagree
 * across the panorama seam. Pinning also keeps packaged tiles and the remote
 * fallback byte-identical.
 *
 * NOAA-20 over Suomi NPP: the SNPP record has recent coverage gaps, and on
 * matched dates NOAA-20 measured a darker, cleaner background (Sahara median
 * 7/255 against SNPP's 45/255).
 *
 * To re-pin: choose a date, then verify coverage across the location catalog
 * before shipping it — a single day can be gap-filled unevenly by region.
 */
export const VIIRS_GIBS_LAYER =
	'VIIRS_NOAA20_GapFilled_BRDF_Corrected_DayNightBand_Radiance';

/** Pinned acquisition date. Read "Why a PINNED date" above before changing. */
export const VIIRS_GIBS_DATE = '2026-07-15';

export const VIIRS_GIBS_BASE = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${VIIRS_GIBS_LAYER}/default/${VIIRS_GIBS_DATE}/GoogleMapsCompatible_Level8`;
