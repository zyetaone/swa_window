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
 * How dark it is: 0 in full day, 1 once the sun is well below the horizon.
 *
 * Takes the sun's ACTUAL elevation, not the clock. The version this replaces
 * was `nightFactor(timeOfDay)` with the hours hardcoded -- dark 21:00-05:00,
 * dusk ramped 17:30-21:00 -- which knows nothing about latitude or season and
 * is therefore only correct near the equator at an equinox. Everywhere else it
 * disagreed with `sunPosition`, computed three lines above it from the same
 * wall-clock second, and the disagreement was visible: at Mumbai 19:41 it
 * returned 0.68 while the sun was 20 degrees below the horizon, so the ground
 * graded to `brightness-max` 0.36 instead of 0.16 and lit the night with a pale
 * sheet brighter than the sky over it. At Chicago's 41.9N the error runs the
 * other way in December -- sunset near 16:20 while this still returned 0, full
 * daylight ground under a dark sky -- and reverses again in June.
 *
 * -12 to +6 is the civil/nautical twilight band. Still pure and still a
 * function of wall-clock and place alone, so three panes agree.
 */
export function nightAmount(sunElevationDeg: number): number {
	return 1 - smoothstep(-12, 6, sunElevationDeg);
}

/**
 * How much sunset colour the sky vault takes, 0..1.
 *
 * Symmetric about the horizon via `Math.abs`, so dawn dims like dusk, and eased
 * rather than linear — a linear ramp changes colour at a constant rate, which
 * reads as a wipe instead of a sunset.
 */
export function duskVaultMix(sunElevationDeg: number): number {
	const t = Math.max(0, Math.min(1, (Math.abs(sunElevationDeg) - -6) / (14 - -6)));
	return 1 - t * t * (3 - 2 * t);
}

/**
 * How much sunset orange the HORIZON takes, 0..1.
 *
 * Was `(15 - elev) / 15`: not symmetric, and still 0.33 at 10 deg of elevation,
 * which is mid-morning. Blending a deep orange into a blue horizon at that
 * strength produces grey-pink mud rather than either colour. Gone by 8 deg.
 *
 * That replacement clamped at -4 and never came back down, so it returned a
 * FULL sunset band for every sun below the horizon -- 1.0 at -18, and 1.0 at
 * -56, which is local midnight in the Sahara with a warm orange glow banding
 * the horizon under a field of stars. It was not a dusk curve, it was a
 * not-daytime curve. `duskVaultMix` escapes the same bug only by accident,
 * through its `Math.abs`.
 *
 * A glow needs a sun to cast it. This one lives in a band: it rises as the sun
 * drops toward the horizon, holds through civil twilight, and is gone by -18
 * where the sky has no sunlight left in it.
 */
export function duskHorizonMix(sunElevationDeg: number): number {
	const lit = smoothstep(-18, -6, sunElevationDeg);
	const notYetDay = 1 - smoothstep(-4, 8, sunElevationDeg);
	return Math.min(lit, notYetDay);
}

/**
 * The local hour at which the sun sits at `targetElevationDeg`, on this day.
 *
 * WHY A PRESET CANNOT JUST NAME AN HOUR. Sunset is not a time of day. At Las
 * Vegas the sun is +10.6 deg at 18:25 in June and -16.4 deg at the same hour in
 * December, so the "Golden Hour Cruise" preset — authored as `localHour: 18.25,
 * // low amber sun, just before the horizon` — was a correct sunset for about
 * four months of the year and pitch dark from October to February. Measured
 * across a full year, its sun elevation ranged +10.5 to -15.2.
 *
 * That is the same class of bug the `localHour` field itself was introduced to
 * fix: the presets were originally authored as `clockOffsetH` deltas, which
 * held only when the real local hour happened to match. This is one layer
 * further out — an hour holds all day but not all YEAR.
 *
 * Solves the standard hour-angle equation for the requested elevation:
 *
 *     sin(elev) = sin(lat)sin(dec) + cos(lat)cos(dec)cos(H)
 *
 * `evening` picks which of the two daily solutions to take; the sun passes
 * every elevation twice, once climbing and once descending.
 *
 * Returns null when the elevation is unreachable that day, which is a real
 * case rather than an error: above the Arctic circle in midsummer the sun
 * never sets, so there is no hour at which it sits at -6. The caller decides
 * what to do, and `applyPreset` falls back to the authored clock hour.
 */
export function localHourAtSunElevation(
	targetElevationDeg: number,
	wallSec: number,
	lat: number,
	evening = true
): number | null {
	const declination = 23.44 * Math.sin((360 / 365) * (dayOfYear(wallSec) - 81) * DEG2RAD);
	const latRad = lat * DEG2RAD;
	const decRad = declination * DEG2RAD;

	const cosH =
		(Math.sin(targetElevationDeg * DEG2RAD) - Math.sin(latRad) * Math.sin(decRad)) /
		(Math.cos(latRad) * Math.cos(decRad));

	// |cosH| > 1 means the sun does not reach that elevation today at all.
	if (!Number.isFinite(cosH) || cosH < -1 || cosH > 1) return null;

	const hourAngle = (Math.acos(cosH) * RAD2DEG) / 15;
	return evening ? 12 + hourAngle : 12 - hourAngle;
}
