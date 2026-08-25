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
	/**
	 * Where the window looks, relative to where the aircraft is going.
	 *
	 * 0 would be the windscreen. A passenger window is roughly perpendicular, so
	 * the default is -90 — out of the left side. This is also the ONLY value that
	 * differs between the three panes of the wall: one aircraft, one clock, one
	 * atmosphere, three azimuths whose frusta tile into a single window.
	 */
	readonly windowAzimuthDeg: number;
}

/** Left-hand window. Panes 0/1/2 of the wall would be -105 / -90 / -75. */
export const DEFAULT_WINDOW_AZIMUTH_DEG = -90;

export interface DaylightConfig {
	readonly syncIntervalMs: number;
	readonly timeZoneOverride: string;
}

export class CameraConfig {
	constructor(windowAzimuthDeg: number = DEFAULT_WINDOW_AZIMUTH_DEG) {
		this.view = { pitchDeg: -18, windowAzimuthDeg };
	}

	/** ~6 min per orbit. See orbitRate(): rate = driftRate * flightSpeed / meanRadius. */
	readonly orbit: OrbitConfig = {
		driftRate: 3.42e-4,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180
	};
	readonly view: ViewConfig;
	readonly flightSpeed = 6.0;
}

export class DirectorConfig {
	readonly daylight: DaylightConfig = {
		syncIntervalMs: 60_000,
		timeZoneOverride: ''
	};
}

export class ConfigTree {
	readonly camera: CameraConfig;
	readonly director = new DirectorConfig();

	constructor(windowAzimuthDeg?: number) {
		this.camera = new CameraConfig(windowAzimuthDeg);
	}
}
