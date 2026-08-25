import { orbitPose } from '#lib/flight/orbit.js';
import { resolveLocalHours } from '#lib/model/local-time.js';
import type { ConfigTree } from '#lib/model/config.svelte.js';
import type { Location } from '#lib/location.js';
import { resolveAtmosphere } from '#lib/world/atmosphere.js';
import { CameraPose, GlobeSyncSlice } from '#lib/types.js';

/** Orbit pose + local time — owns reactive flight fields. */
export class FlightEngine {
	lat = $state(0);
	lon = $state(0);
	headingDeg = $state(20);
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

	tick(_dt: number): void {
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
		return new CameraPose(this.lat, this.lon, view.altitudeM, this.headingDeg, view.pitchDeg);
	}

	frame(): GlobeSyncSlice {
		return new GlobeSyncSlice(
			this.cameraPose(),
			resolveAtmosphere(this.config.camera.view.altitudeM),
		);
	}
}
