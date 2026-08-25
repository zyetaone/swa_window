/**
 * Tuning knobs read imperatively each tick.
 *
 * Deliberately NOT runes: nothing subscribes to these, so `$state` would only
 * add proxy overhead on a hot path for reactivity no one consumes.
 */

export interface OrbitConfig {
	readonly driftRate: number;
	readonly majorMin: number;
	readonly majorMax: number;
	readonly breathePeriod: number;
}

export interface ViewConfig {
	readonly pitchDeg: number;
}

export interface DaylightConfig {
	readonly syncIntervalMs: number;
	readonly timeZoneOverride: string;
}

export class CameraConfig {
	/** ~6 min per orbit. See orbitRate(): rate = driftRate * flightSpeed / meanRadius. */
	readonly orbit: OrbitConfig = {
		driftRate: 3.42e-4,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180
	};
	readonly view: ViewConfig = { pitchDeg: -18 };
	readonly flightSpeed = 6.0;
}

export class DirectorConfig {
	readonly daylight: DaylightConfig = {
		syncIntervalMs: 60_000,
		timeZoneOverride: ''
	};
}

export class ConfigTree {
	readonly camera = new CameraConfig();
	readonly director = new DirectorConfig();
}
