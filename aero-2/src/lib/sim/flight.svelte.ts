/**
 * Flight simulation engine — updates orbit pose and time of day.
 */
import { altitudeAt, orbitPose } from '#lib/rules.js';
import { ALTITUDE_FLOOR_M } from '#lib/content/flight.js';
import type { Location } from '#lib/content/locations.js';
import type { ConfigTree } from '#lib/sim/config.js';
import { CameraPose, GlobeSyncSlice } from '#lib/sim/frame.js';
import { resolveLocalHours } from '#lib/sim/local-time.js';

export class FlightEngine {
	lat = $state(0);
	lon = $state(0);
	headingDeg = $state(20);
	altitudeM = $state(ALTITUDE_FLOOR_M);
	timeOfDay = $state(12);

	#orbitAngle = 0.5;
	#orbitEpochWallT: number | null = null;
	#orbitEpochAngle = this.#orbitAngle;
	#lastDaylightSyncMs = 0;

	constructor(
		private readonly config: ConfigTree,
		private readonly location: Location,
	) {
		this.lat = location.lat;
		this.lon = location.lon;
	}

	/** Wall-clock, never accumulated dt — the three Pis must agree. */
	tick(): void {
		const wallT = Date.now() / 1000;
		const { orbit, flightSpeed } = this.config.camera;

		if (this.#orbitEpochWallT === null) {
			this.#orbitEpochWallT = wallT;
			this.#orbitEpochAngle = this.#orbitAngle;
		}

		const pose = orbitPose({
			wallT,
			centerLat: this.location.lat,
			centerLon: this.location.lon,
			orbitAngle0: this.#orbitEpochAngle,
			orbitEpochWallT: this.#orbitEpochWallT,
			orbitBearingRad: 0,
			direction: 1,
			majorMin: orbit.majorMin,
			majorMax: orbit.majorMax,
			breathePeriod: orbit.breathePeriod,
			driftRate: orbit.driftRate,
			flightSpeed,
		});

		this.#orbitAngle = pose.orbitAngle;
		this.lat = pose.lat;
		this.lon = pose.lon;
		this.headingDeg = pose.headingDeg;
		this.altitudeM = altitudeAt(wallT);

		const { daylight } = this.config.director;
		const nowMs = Date.now();
		if (this.#lastDaylightSyncMs === 0 || nowMs - this.#lastDaylightSyncMs >= daylight.syncIntervalMs) {
			this.#lastDaylightSyncMs = nowMs;
			this.timeOfDay = resolveLocalHours({
				timeZone: this.location.timeZone,
				utcOffset: this.location.utcOffset,
				zoneOverride: daylight.timeZoneOverride,
			});
		}
	}

	cameraPose(): CameraPose {
		const { view } = this.config.camera;
		return new CameraPose(this.lat, this.lon, this.altitudeM, this.headingDeg, view.pitchDeg);
	}

	frame(): GlobeSyncSlice {
		return new GlobeSyncSlice(this.cameraPose(), this.timeOfDay);
	}
}
