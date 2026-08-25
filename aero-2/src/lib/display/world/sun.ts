/**
 * Solar diurnal clock, local solar time, and day/night lighting curves.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

export function resolveLocalHours(wallSec: number, utcOffset: number): number {
	const utcSeconds = wallSec % 86_400;
	const localSeconds = (utcSeconds + utcOffset * 3600 + 86_400) % 86_400;
	return localSeconds / 3600;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Day of year, 1..366, from a wall-clock epoch in seconds. */
function dayOfYear(wallSec: number): number {
	const d = new Date(wallSec * 1000);
	const start = Date.UTC(d.getUTCFullYear(), 0, 0);
	return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86_400_000;
}

export interface SunPosition {
	/** Compass bearing of the sun, degrees clockwise from true north. */
	azimuthDeg: number;
	/** Degrees above the horizon. Negative when the sun is down. */
	elevationDeg: number;
}

/**
 * Where the sun actually is, for a place and a moment.
 *
 * Standard solar-position geometry: axial tilt gives the declination for the
 * day, the hour angle gives the time of day, and the two combine into a
 * bearing and an altitude. Accurate to a degree or so — far below what a
 * hillshade can show, and enough to make shadows swing the right way through
 * the day instead of being pinned to a hardcoded north-west.
 *
 * Pure and deterministic: same wall-clock second and place on three Pis gives
 * three identical suns, which is what keeps the panorama seam consistent.
 */
export function sunPosition(wallSec: number, lat: number, utcOffset: number): SunPosition {
	const hours = resolveLocalHours(wallSec, utcOffset);
	// Axial tilt, zeroed at the March equinox (~day 81).
	const declination = 23.44 * Math.sin((360 / 365) * (dayOfYear(wallSec) - 81) * DEG2RAD);
	// 15 degrees per hour; negative before local noon, positive after.
	const hourAngle = (hours - 12) * 15;

	const latRad = lat * DEG2RAD;
	const decRad = declination * DEG2RAD;
	const haRad = hourAngle * DEG2RAD;

	const sinElevation =
		Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
	const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

	const cosAzimuth =
		(Math.sin(decRad) - Math.sin(elevation) * Math.sin(latRad)) /
		(Math.cos(elevation) * Math.cos(latRad));
	let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * RAD2DEG;
	// acos loses the sign: before noon the sun is east, after noon it is west.
	if (hourAngle > 0) azimuth = 360 - azimuth;

	return { azimuthDeg: azimuth, elevationDeg: elevation * RAD2DEG };
}

/**
 * Night factor: 0.0 at solar noon (pure day) -> 1.0 at midnight (deep night).
 * Dusk transition: 18:00 - 20:30.
 * Dawn transition: 05:30 - 07:30.
 */
export function nightFactor(timeOfDay: number): number {
	const h = ((timeOfDay % 24) + 24) % 24;

	if (h >= 8 && h <= 17.5) return 0;
	if (h >= 21 || h <= 5) return 1;

	if (h > 17.5 && h < 21) {
		return smoothstep(17.5, 21, h);
	}

	return 1 - smoothstep(5, 8, h);
}
