/**
 * Flat DTOs at the model/world boundary — plain classes, no Cesium types.
 */
import type { AtmosphereState } from '#lib/world/atmosphere.js';

export class CameraPose {
	readonly lat: number;
	readonly lon: number;
	readonly altitudeM: number;
	readonly headingDeg: number;
	readonly pitchDeg: number;

	constructor(lat: number, lon: number, altitudeM: number, headingDeg: number, pitchDeg: number) {
		this.lat = lat;
		this.lon = lon;
		this.altitudeM = altitudeM;
		this.headingDeg = headingDeg;
		this.pitchDeg = pitchDeg;
	}
}

export class GlobeSyncSlice {
	readonly camera: CameraPose;
	readonly atmosphere: AtmosphereState;

	constructor(camera: CameraPose, atmosphere: AtmosphereState) {
		this.camera = camera;
		this.atmosphere = atmosphere;
	}
}
