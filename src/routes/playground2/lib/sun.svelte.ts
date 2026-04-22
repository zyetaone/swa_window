/**
 * sun.svelte.ts — sun direction helper.
 *
 * Simple solar geometry for the layer visualizer. Inputs: time of
 * day [0..24] + latitude. Returns an elevation (deg, 0 = horizon,
 * 90 = zenith) and azimuth (deg, 0 = north, 90 = east).
 *
 * Good enough for grid-1 sky + atmosphere driving. We'll swap to
 * takram's getSunDirectionECEF (which takes a real Date) when we
 * wire takram atmosphere; that version handles year/month/day and
 * Earth tilt. For now an equinox approximation is fine — the goal
 * is visible, phase-appropriate sky in every cell.
 */

import * as THREE from 'three';

export type SolarVec = { elevationDeg: number; azimuthDeg: number };

/**
 * Solar position, equinox-simplified.
 *
 * Sun rises due east at 6h, peaks at 12h (altitude = 90° - |lat|),
 * sets due west at 18h. Below-horizon hours return negative
 * elevation.
 */
export function solarPosition(timeOfDay: number, latDeg: number): SolarVec {
	const hourAngleDeg = (timeOfDay - 12) * 15; // 15° per hour
	const hourAngle = (hourAngleDeg * Math.PI) / 180;
	const latRad = (latDeg * Math.PI) / 180;
	const declRad = 0; // equinox — swap for real calendar later

	// Standard solar altitude formula.
	const sinAlt =
		Math.sin(declRad) * Math.sin(latRad) +
		Math.cos(declRad) * Math.cos(latRad) * Math.cos(hourAngle);
	const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

	// Azimuth — measured from north, clockwise.
	const cosAz =
		(Math.sin(declRad) - Math.sin(alt) * Math.sin(latRad)) / (Math.cos(alt) * Math.cos(latRad));
	let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
	if (hourAngle > 0) az = 2 * Math.PI - az;

	return {
		elevationDeg: (alt * 180) / Math.PI,
		azimuthDeg: (az * 180) / Math.PI,
	};
}

/**
 * Three.js Sky.js expects a unit vector where y = up, z = north,
 * x = east. We convert elevation/azimuth to that frame.
 */
export function sunVectorForSky(timeOfDay: number, latDeg: number): THREE.Vector3 {
	const { elevationDeg, azimuthDeg } = solarPosition(timeOfDay, latDeg);
	const elev = (elevationDeg * Math.PI) / 180;
	const az = (azimuthDeg * Math.PI) / 180;
	// az = 0 → north = +Z ; az = 90 → east = +X ; elev = altitude above horizon
	const cosElev = Math.cos(elev);
	return new THREE.Vector3(
		cosElev * Math.sin(az),
		Math.sin(elev),
		cosElev * Math.cos(az),
	).normalize();
}
