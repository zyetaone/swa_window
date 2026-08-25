/**
 * Config SSOT — class namespaces with $state leaves. Add namespaces only when
 * a slice needs them; do not pre-port v1's full tree.
 */

export class CameraConfig {
	orbit = $state({
		driftRate: 0.018,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180,
	});

	view = $state({
		altitudeM: 10_000,
		pitchDeg: -18,
	});

	/** Cruise speed knob — scenario pacing arrives in a later slice. */
	flightSpeed = $state(6.0);
}

export class DirectorConfig {
	daylight = $state({
		syncIntervalMs: 60_000,
		timeZoneOverride: '',
	});
}

export class ConfigTree {
	readonly camera = new CameraConfig();
	readonly director = new DirectorConfig();
}
