/**
 * Window camera geometry, look-at ground target, and MapLibre viewport projection.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

import { normalizeHeading, FlightTrack, type OrbitPose } from './flight-path.js';
import { roleYawOffsetDeg, type FleetRole } from './parallax.js';
import { resolveLocalHours } from '../world/sun.js';

export interface CameraParams {
	place: {
		lat: number;
		lon: number;
		utcOffset: number;
		/** Feature locations are crossed, not orbited — see the aim below. */
		isFeature?: boolean;
	};
	azimuthDeg: number;
	pitchDeg: number;
	floorM: number;
	ceilingM: number;
	/** +1 or -1: which way round the loop is flown. */
	direction?: 1 | -1;
	/** Radians of phase offset, from `daySeed`. */
	phase?: number;
	/** Simulation flight speed multiplier (e.g. 2.5x). */
	speed?: number;
	/** Hours added to the destination's UTC offset. Tuning only; 0 on the wall. */
	clockOffsetH?: number;
	/** Multi-Pi Fleet Parallax Role */
	fleetRole?: FleetRole;
	/** Weather condition (drives procedural turbulence intensity) */
	weather?: 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm';
}

export const DEFAULT_WINDOW_AZIMUTH_DEG = 0;
export const DEFAULT_PITCH_DEG = -10;

const DEG2RAD = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/**
 * Procedural atmospheric turbulence model.
 * Produces micro-shakes, low-frequency atmospheric bumps, and wing flutter.
 * Coupled directly to weather conditions (storm > overcast > rain > cloudy > clear).
 */
export function atmosphericTurbulence(
	wallSec: number,
	weather: 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm' = 'clear'
): {
	pitchJitterDeg: number;
	rollJitterDeg: number;
	verticalBumpM: number;
	wingFlutterPx: number;
	intensity: number;
} {
	const intensityMap = {
		clear: 0.04,
		cloudy: 0.16,
		rain: 0.38,
		overcast: 0.58,
		storm: 1.0
	};
	const intensity = intensityMap[weather] ?? 0.08;

	// Multi-octave harmonic noise (deterministic off wallSec)
	const lowFreq = Math.sin(wallSec * 0.73) * Math.cos(wallSec * 0.37);
	const midFreq = Math.sin(wallSec * 3.41 + 1.2) * 0.5 + Math.cos(wallSec * 5.13) * 0.3;
	const highFreq = Math.sin(wallSec * 14.7) * Math.sin(wallSec * 22.3) * 0.2;

	const composite = (lowFreq * 0.5 + midFreq * 0.35 + highFreq * 0.15) * intensity;

	return {
		pitchJitterDeg: composite * 0.45,
		rollJitterDeg: composite * 0.75,
		verticalBumpM: composite * 14.0,
		wingFlutterPx: composite * 12.0,
		intensity
	};
}

/** Initial great-circle bearing from one point to another, in degrees. */
function bearingTo(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
	const cosLat = Math.cos(fromLat * DEG2RAD) || 1;
	const dNorth = (toLat - fromLat) * M_PER_DEG_LAT;
	const dEast = (toLon - fromLon) * M_PER_DEG_LAT * cosLat;
	return normalizeHeading((Math.atan2(dEast, dNorth) * 180) / Math.PI);
}

export interface CameraView {
	lat: number;
	lon: number;
	aglM: number;
	planeHeadingDeg: number;
	/** Roll of the airframe, degrees. Negative is left-wing-down. */
	bankDeg: number;
	cameraBearingDeg: number;
	cameraPitchDeg: number;
	targetLat: number;
	targetLon: number;
	distanceM: number;
	timeOfDay: number;
	/** Procedural atmospheric turbulence micro-vibration and wing flutter */
	turbulence: {
		pitchJitterDeg: number;
		rollJitterDeg: number;
		verticalBumpM: number;
		wingFlutterPx: number;
		intensity: number;
	};
	/** The wall-clock second this view was derived from — the only input. */
	wallSec: number;
}

export interface CameraTargetOptions {
	targetLat: number;
	targetLon: number;
	cameraBearingDeg: number;
	cameraPitchDeg: number;
	distanceM: number;
}

/**
 * FlightCamera — ES6 domain model for aircraft camera look-at ground target and viewport projection.
 */
export class FlightCamera {
	constructor(
		public azimuthDeg: number = DEFAULT_WINDOW_AZIMUTH_DEG,
		public pitchDeg: number = DEFAULT_PITCH_DEG
	) {}

	/**
	 * Compute look-at ground target intersection vector from aircraft pose.
	 */
	/**
	 * Where the window looks from a given pose.
	 *
	 * The bearing is measured INWARD — towards the centre of the orbit — rather
	 * than as a fixed offset from the aircraft's heading. The centre is the city,
	 * so this keeps the city in the window for the whole loop.
	 *
	 * With a heading-relative bearing the view swung out over empty countryside
	 * for half of every circuit, because "90 deg off the nose" points outward on
	 * one side of an ellipse and inward on the other. `azimuthDeg` still applies,
	 * but now as a nudge either side of the city rather than as the whole aim.
	 */
	viewOptions(plane: OrbitPose, centerLat?: number, centerLon?: number): CameraTargetOptions {
		const inwardDeg =
			centerLat === undefined || centerLon === undefined
				? plane.headingDeg + 90
				: bearingTo(plane.lat, plane.lon, centerLat, centerLon);

		const cameraBearingDeg = normalizeHeading(inwardDeg + this.azimuthDeg);

		/**
		 * Roll the sightline dynamically with the airframe turn.
		 *
		 * From a window seat the bank IS the turn: the wing drops and the ground
		 * swings up into the glass, or it lifts and you get panoramic sky and cloud layers.
		 * At 0.85 gain, entering a turn dramatically reveals the ground/city below,
		 * and exiting/levelling opens the window to the horizon and sky canopy.
		 */
		const BANK_VIEW_GAIN = 0.85;
		const bankOffset = (plane.bankDeg ?? 0) * BANK_VIEW_GAIN;
		const effectivePitch = this.pitchDeg + bankOffset;
		const depressionDeg = Math.max(0.5, Math.min(89.5, -effectivePitch));
		const depressionRad = depressionDeg * DEG2RAD;

		const groundDistM = plane.aglM / Math.tan(depressionRad);
		const slantDistM = plane.aglM / Math.sin(depressionRad);

		const bearingRad = cameraBearingDeg * DEG2RAD;
		const cosLat = Math.cos((plane.lat * Math.PI) / 180) || 1;

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

	/**
	 * Project full CameraView given flight track pose, local solar UTC offset, and wall-clock timestamp.
	 */
	project(
		plane: OrbitPose,
		utcOffset = 0,
		wallSec = 0,
		centerLat?: number,
		centerLon?: number,
		weather: 'clear' | 'cloudy' | 'rain' | 'overcast' | 'storm' = 'clear'
	): CameraView {
		const cam = this.viewOptions(plane, centerLat, centerLon);
		const timeOfDay = resolveLocalHours(wallSec, utcOffset);
		const turbulence = atmosphericTurbulence(wallSec, weather);

		return {
			lat: plane.lat,
			lon: plane.lon,
			aglM: Math.max(10, plane.aglM + turbulence.verticalBumpM),
			planeHeadingDeg: plane.headingDeg,
			bankDeg: plane.bankDeg + turbulence.rollJitterDeg,
			cameraBearingDeg: cam.cameraBearingDeg,
			cameraPitchDeg: cam.cameraPitchDeg + turbulence.pitchJitterDeg,
			targetLat: cam.targetLat,
			targetLon: cam.targetLon,
			distanceM: cam.distanceM,
			timeOfDay,
			turbulence,
			wallSec
		};
	}
}

export function calculateCameraView(wallSec: number, params: CameraParams): CameraView {
	const track = new FlightTrack(
		params.place.lat,
		params.place.lon,
		params.floorM,
		params.ceilingM,
		params.direction ?? 1,
		params.phase ?? 0
	);
	const effectiveSec = wallSec * (params.speed ?? 1.0);
	const plane = track.poseAt(effectiveSec);
	const roleOffset = roleYawOffsetDeg(params.fleetRole ?? 'solo');
	const camera = new FlightCamera(params.azimuthDeg + roleOffset, params.pitchDeg);

	/**
	 * Cities get an inward aim; features do not.
	 */
	const utcOffset = params.place.utcOffset + (params.clockOffsetH ?? 0);
	const weather = params.weather ?? 'clear';

	return params.place.isFeature
		? camera.project(plane, utcOffset, wallSec, undefined, undefined, weather)
		: camera.project(plane, utcOffset, wallSec, params.place.lat, params.place.lon, weather);
}
