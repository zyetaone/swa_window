/**
 * Window camera geometry, look-at ground target, and MapLibre viewport projection.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

import { normalizeHeading, orbitPose, type OrbitPose } from './orbit.js';
import { resolveLocalHours } from '../atmosphere/sun.js';

export interface CameraParams {
	place: { lat: number; lon: number; utcOffset: number };
	azimuthDeg: number;
	pitchDeg: number;
	floorM: number;
	ceilingM: number;
}

export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;
export const DEFAULT_PITCH_DEG = -18;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const M_PER_DEG_LAT = 111_320;

export interface WindowView {
	planeLat: number;
	planeLon: number;
	planeAglM: number;
	lat: number;
	lon: number;
	aglM: number;
	mslM: number;
	planeHeadingDeg: number;
	cameraBearingDeg: number;
	headingDeg: number;
	cameraPitchDeg: number;
	centerLat: number;
	centerLon: number;
	targetLat: number;
	targetLon: number;
	distanceM: number;
	timeOfDay: number;
}

export function viewOptions(
	plane: OrbitPose,
	azimuthDeg: number = DEFAULT_WINDOW_AZIMUTH_DEG,
	pitchDeg: number = DEFAULT_PITCH_DEG
): {
	targetLat: number;
	targetLon: number;
	cameraBearingDeg: number;
	cameraPitchDeg: number;
	distanceM: number;
} {
	const cameraBearingDeg = normalizeHeading(plane.headingDeg + azimuthDeg);
	const depressionDeg = Math.max(1, Math.min(89, -pitchDeg));
	const depressionRad = depressionDeg * DEG2RAD;

	const groundDistM = plane.aglM / Math.tan(depressionRad);
	const slantDistM = plane.aglM / Math.sin(depressionRad);

	const bearingRad = cameraBearingDeg * DEG2RAD;
	const cosLat = Math.cos(plane.lat * DEG2RAD) || 1;

	const dNorthM = groundDistM * Math.cos(bearingRad);
	const dEastM = groundDistM * Math.sin(bearingRad);

	const targetLat = plane.lat + dNorthM / M_PER_DEG_LAT;
	const targetLon = plane.lon + dEastM / (M_PER_DEG_LAT * cosLat);

	return {
		targetLat,
		targetLon,
		cameraBearingDeg,
		cameraPitchDeg: 90 - depressionDeg,
		distanceM: slantDistM
	};
}

export function windowView(wallSec: number, params: CameraParams): WindowView {
	const plane = orbitPose(
		wallSec,
		params.place.lat,
		params.place.lon,
		params.floorM,
		params.ceilingM
	);

	const cam = viewOptions(plane, params.azimuthDeg, params.pitchDeg);
	const timeOfDay = resolveLocalHours(wallSec, params.place.utcOffset);

	return {
		planeLat: plane.lat,
		planeLon: plane.lon,
		planeAglM: plane.aglM,
		lat: plane.lat,
		lon: plane.lon,
		aglM: plane.aglM,
		mslM: plane.aglM,
		planeHeadingDeg: plane.headingDeg,
		cameraBearingDeg: cam.cameraBearingDeg,
		headingDeg: cam.cameraBearingDeg,
		cameraPitchDeg: cam.cameraPitchDeg,
		centerLat: cam.targetLat,
		centerLon: cam.targetLon,
		targetLat: cam.targetLat,
		targetLon: cam.targetLon,
		distanceM: cam.distanceM,
		timeOfDay
	};
}
