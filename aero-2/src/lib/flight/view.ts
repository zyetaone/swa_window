/**
 * The whole aircraft state for one instant, in one pure call.
 *
 * This exists so the component's frame callback has no maths in it: the page
 * asks "where am I and where am I looking at time t", gets a struct back, and
 * hands it to MapLibre. That also means the motion model is testable without a
 * WebGL context, which is the only way the three-pane determinism claim can be
 * checked at all.
 */

import { resolveLocalHours } from '#lib/flight/clock.js';
import { altitudeAt, normalizeHeading, orbitPose } from '#lib/flight/rules.js';
import { lookTarget } from '#lib/flight/look-target.js';
import { ORBIT } from '#lib/window/config.js';
import type { WindowParams } from '#lib/window/params.js';

export interface WindowView {
	/** Eye position. */
	readonly lat: number;
	readonly lon: number;
	/** Height above ground, metres. */
	readonly aglM: number;
	/** Height above sea level, metres — what the camera is actually placed at. */
	readonly mslM: number;
	/** Where the aircraft is going. */
	readonly trackDeg: number;
	/** Where this pane looks: track + its azimuth offset. */
	readonly headingDeg: number;
	/** The ground point the camera aims at. */
	readonly targetLat: number;
	readonly targetLon: number;
	/** Local wall-clock hours at the place being flown over. */
	readonly timeOfDay: number;
}

/**
 * `wallT` is seconds since the epoch, NOT a per-process clock. Every pose is an
 * absolute function of it, so three Pis booted minutes apart compute the same
 * aircraft for the same instant.
 */
export function windowView(wallT: number, params: WindowParams, now?: Date): WindowView {
	const { place } = params;

	const pose = orbitPose({
		wallT,
		centerLat: place.lat,
		centerLon: place.lon,
		orbitAngle0: 0.5,
		orbitBearingRad: 0,
		direction: 1,
		...ORBIT
	});

	const aglM = altitudeAt(wallT, params.floorM, params.ceilingM);
	const headingDeg = normalizeHeading(pose.headingDeg + params.azimuthDeg);
	const target = lookTarget(pose.lat, pose.lon, aglM, headingDeg, params.pitchDeg);

	return {
		lat: pose.lat,
		lon: pose.lon,
		aglM,
		mslM: place.groundElevationM + aglM,
		trackDeg: pose.headingDeg,
		headingDeg,
		targetLat: target.lat,
		targetLon: target.lon,
		timeOfDay: resolveLocalHours({ timeZone: place.timeZone, utcOffset: place.utcOffset, now })
	};
}
