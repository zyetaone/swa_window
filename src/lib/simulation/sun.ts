/**
 * sun.ts — shared solar geometry math.
 *
 * Inputs: time-of-day in hours [0, 24] + latitude in degrees. Outputs:
 * elevation + azimuth (degrees) or a Three.js Y-up unit vector suitable
 * for Sky.js, takram `sunDirection` (which does its own ECEF→world
 * conversion internally), and `DirectionalLight.position`. All three
 * consumers use the same Three.js world-space Y-up frame, so one vector
 * serves them all — no per-consumer frame adapter needed.
 *
 * Equinox-simplified (declination = 0). Good enough for visually
 * correct phase-appropriate sky. Swap to a real ECI-from-Date formula
 * (e.g. suncalc's getSunPosition) when the simulator needs
 * astronomically-accurate sun at arbitrary dates.
 */

import * as THREE from 'three';

export interface SolarPosition {
	/** 0° = horizon, 90° = zenith, negative below horizon. */
	elevationDeg: number;
	/** 0° = north, 90° = east, clockwise (compass convention). */
	azimuthDeg: number;
}

/**
 * Solar position using the standard altitude/azimuth formulas with an
 * equinox-simplified declination of 0.
 *
 * At solar noon (timeOfDay = 12): elevation = 90° − |lat|.
 * At 6h: sun rises due east. At 18h: sun sets due west.
 */
export function solarPosition(timeOfDay: number, latDeg: number): SolarPosition {
	const hourAngleDeg = (timeOfDay - 12) * 15; // 15° per hour
	const hourAngle = (hourAngleDeg * Math.PI) / 180;
	const latRad = (latDeg * Math.PI) / 180;
	const declRad = 0; // equinox approximation

	// Standard altitude formula.
	const sinAlt =
		Math.sin(declRad) * Math.sin(latRad) +
		Math.cos(declRad) * Math.cos(latRad) * Math.cos(hourAngle);
	const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

	// Azimuth from north, clockwise.
	const cosAz =
		(Math.sin(declRad) - Math.sin(alt) * Math.sin(latRad)) /
		(Math.cos(alt) * Math.cos(latRad) || 1e-9);
	let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
	if (hourAngle > 0) az = 2 * Math.PI - az;

	return {
		elevationDeg: (alt * 180) / Math.PI,
		azimuthDeg: (az * 180) / Math.PI,
	};
}

/**
 * Three.js Y-up unit vector pointing toward the sun.
 *
 * Frame: x = east, y = up, z = north (matches Three.js Sky.js,
 * takram's world-space input for `sunDirection`, and a bare
 * DirectionalLight whose `.position` is interpreted as a direction
 * vector from scene origin).
 *
 * @param out  Optional pre-allocated Vector3 to write into (kills
 *             per-frame heap alloc when called inside a render loop).
 *             Returned unchanged if the caller mutates.
 */
export function sunVectorForSky(
	timeOfDay: number,
	latDeg: number,
	out: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 {
	const { elevationDeg, azimuthDeg } = solarPosition(timeOfDay, latDeg);
	const elev = (elevationDeg * Math.PI) / 180;
	const az = (azimuthDeg * Math.PI) / 180;
	const cosElev = Math.cos(elev);
	return out.set(
		cosElev * Math.sin(az), // x = east
		Math.sin(elev),          // y = up
		cosElev * Math.cos(az),  // z = north
	).normalize();
}
