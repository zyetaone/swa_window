/**
 * NASA GIBS VIIRS Black Marble WMTS endpoint — THE single copy.
 *
 * Consumed by BOTH renderers: world/compose.ts (Cesium night-lights imagery
 * layer, `{z}/{y}/{x}` UrlTemplate tokens) and world-three/viirs-field.ts
 * (per-tile canvas sampling for the neon/bokeh layers). This host already
 * moved once (the old map1.vis.earthdata.nasa.gov/wmts-webmerc host now
 * returns InvalidParameter) and had to be fixed in two places — hence the
 * SSOT. Framework-free on purpose: importing it crosses the world/ ↔
 * world-three/ boundary without touching Cesium (invariant #1 intact).
 */
export const VIIRS_GIBS_BASE =
	'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8';
