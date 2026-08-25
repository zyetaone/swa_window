/**
 * Where the camera aims.
 *
 * MapLibre has no free camera (that is Mapbox). The equivalent is to position
 * the eye at an altitude and aim it at a GROUND POINT, letting MapLibre derive
 * centre/zoom/bearing/pitch. To hold a fixed depression angle, that point sits
 * along the window azimuth at a distance derived from the height:
 * `D = h / tan(depression)`.
 *
 * Pure trig, no renderer — which is why the motion model can be tested without
 * a WebGL context.
 */

const M_PER_DEG_LAT = 111_320;

export interface LookTarget {
	readonly lat: number;
	readonly lon: number;
	readonly distanceM: number;
}

/**
 * Where the camera should aim, given where it is and which way the window faces.
 *
 * `pitchDeg` is negative for looking down, matching the rest of the codebase.
 */
export function lookTarget(
	lat: number,
	lon: number,
	aglM: number,
	azimuthDeg: number,
	pitchDeg: number
): LookTarget {
	const depression = Math.max(1, Math.abs(pitchDeg));
	const distanceM = aglM / Math.tan((depression * Math.PI) / 180);
	const az = (azimuthDeg * Math.PI) / 180;

	const north = distanceM * Math.cos(az);
	const east = distanceM * Math.sin(az);
	const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);

	return {
		lat: lat + north / M_PER_DEG_LAT,
		lon: lon + east / (M_PER_DEG_LAT * cosLat),
		distanceM
	};
}
