/**
 * CameraConfig — how we look at the map.
 *
 * SSOT: default values come from `constants.ts` (AIRCRAFT + FLIGHT_FEEL).
 * `$state` wraps them so admin push can mutate at runtime.
 */

import { AIRCRAFT, FLIGHT_FEEL } from '$lib/constants';

export type DeviceRole = 'solo' | 'left' | 'center' | 'right';

export class OrbitConfig {
	driftRate: number     = $state(AIRCRAFT.DRIFT_RATE);
	major: number         = $state(AIRCRAFT.ORBIT_MAJOR);
	minor: number         = $state(AIRCRAFT.ORBIT_MINOR);
	majorMin: number      = $state(AIRCRAFT.ORBIT_MAJOR_MIN);
	majorMax: number      = $state(AIRCRAFT.ORBIT_MAJOR_MAX);
	breathePeriod: number = $state(AIRCRAFT.ORBIT_BREATHE_PERIOD);
}

export class CruiseConfig {
	/** Warp ramp-up duration (seconds). Local default — no constant yet. */
	departureDurationSec = $state(2.0);
	transitDurationSec   = $state(2.0);
	defaultSpeed         = $state(1.4);
	minSpeed             = $state(0.1);
	maxSpeed             = $state(3.0);
}

export class MotionConfig {
	bankAngleMax: number       = $state(FLIGHT_FEEL.BANK_ANGLE_MAX);
	bankSmoothing: number      = $state(FLIGHT_FEEL.BANK_SMOOTHING);

	breathingPeriod: number    = $state(FLIGHT_FEEL.BREATHING_PERIOD);
	breathingAmplitude: number = $state(FLIGHT_FEEL.BREATHING_AMPLITUDE);

	engineVibeFreqX: number = $state(FLIGHT_FEEL.ENGINE_VIBE_FREQ_X);
	engineVibeFreqY: number = $state(FLIGHT_FEEL.ENGINE_VIBE_FREQ_Y);
	engineVibeAmp: number   = $state(FLIGHT_FEEL.ENGINE_VIBE_AMP);

	bumpMinInterval: number = $state(FLIGHT_FEEL.BUMP_MIN_INTERVAL);
	bumpMaxInterval: number = $state(FLIGHT_FEEL.BUMP_MAX_INTERVAL);
	bumpDecay: number       = $state(FLIGHT_FEEL.BUMP_DECAY);
	bumpRingFreq: number    = $state(FLIGHT_FEEL.BUMP_RING_FREQ);
	bumpAmplitude: number   = $state(FLIGHT_FEEL.BUMP_AMPLITUDE);

	turbulenceMultipliers = $state({ ...AIRCRAFT.TURBULENCE_MULTIPLIERS });
	turbulenceOffsetY: number     = $state(AIRCRAFT.TURBULENCE_OFFSET_Y);
}

export class AltitudeConfig {
	default: number = $state(AIRCRAFT.DEFAULT_ALTITUDE);
	min: number     = $state(AIRCRAFT.MIN_ALTITUDE);
	max: number     = $state(AIRCRAFT.MAX_ALTITUDE);
}

/**
 * Parallax — per-device camera yaw. Phase 7 wires this to the compose.ts
 * camera heading so three Pis side-by-side form a continuous panorama.
 * Solo devices run with role='solo' and zero offset (default).
 */
export class ParallaxConfig {
	role = $state<DeviceRole>('solo');
	headingOffsetDeg = $state(0);
	fovDeg = $state(60);
	/** Total arc spanned by the 3-device panorama (degrees). */
	panoramaArcDeg = $state(44);
}

export class CameraConfig {
	orbit    = new OrbitConfig();
	cruise   = new CruiseConfig();
	motion   = new MotionConfig();
	altitude = new AltitudeConfig();
	parallax = new ParallaxConfig();

	/** Sets the parallax role + default yaw offset based on panorama arc. */
	setRole(role: DeviceRole): void {
		this.parallax.role = role;
		if (role === 'solo' || role === 'center') this.parallax.headingOffsetDeg = 0;
		else if (role === 'left')  this.parallax.headingOffsetDeg = -this.parallax.panoramaArcDeg / 2 + this.parallax.panoramaArcDeg / 6;
		else if (role === 'right') this.parallax.headingOffsetDeg = +this.parallax.panoramaArcDeg / 2 - this.parallax.panoramaArcDeg / 6;
	}

	/** Apply per-device yaw to the shared base heading. */
	effectiveHeading(baseHeading: number): number {
		return (baseHeading + this.parallax.headingOffsetDeg + 360) % 360;
	}

	setPath(path: string, value: unknown): boolean {
		const [head, sub] = path.split('.');
		switch (head) {
			case 'orbit':
				switch (sub) {
					case 'driftRate':     this.orbit.driftRate     = value as number; return true;
					case 'major':         this.orbit.major         = value as number; return true;
					case 'minor':         this.orbit.minor         = value as number; return true;
					case 'majorMin':      this.orbit.majorMin      = value as number; return true;
					case 'majorMax':      this.orbit.majorMax      = value as number; return true;
					case 'breathePeriod': this.orbit.breathePeriod = value as number; return true;
				}
				return false;
			case 'cruise':
				switch (sub) {
					case 'departureDurationSec': this.cruise.departureDurationSec = value as number; return true;
					case 'transitDurationSec':   this.cruise.transitDurationSec   = value as number; return true;
					case 'defaultSpeed':         this.cruise.defaultSpeed         = value as number; return true;
					case 'minSpeed':             this.cruise.minSpeed             = value as number; return true;
					case 'maxSpeed':             this.cruise.maxSpeed             = value as number; return true;
				}
				return false;
			case 'motion':
				switch (sub) {
					case 'bankAngleMax':        this.motion.bankAngleMax        = value as number; return true;
					case 'bankSmoothing':       this.motion.bankSmoothing       = value as number; return true;
					case 'breathingPeriod':     this.motion.breathingPeriod     = value as number; return true;
					case 'breathingAmplitude':  this.motion.breathingAmplitude  = value as number; return true;
					case 'engineVibeFreqX':     this.motion.engineVibeFreqX     = value as number; return true;
					case 'engineVibeFreqY':     this.motion.engineVibeFreqY     = value as number; return true;
					case 'engineVibeAmp':       this.motion.engineVibeAmp       = value as number; return true;
					case 'bumpMinInterval':     this.motion.bumpMinInterval     = value as number; return true;
					case 'bumpMaxInterval':     this.motion.bumpMaxInterval     = value as number; return true;
					case 'bumpDecay':           this.motion.bumpDecay           = value as number; return true;
					case 'bumpRingFreq':        this.motion.bumpRingFreq        = value as number; return true;
					case 'bumpAmplitude':       this.motion.bumpAmplitude       = value as number; return true;
					case 'turbulenceMultipliers':
						this.motion.turbulenceMultipliers = value as typeof this.motion.turbulenceMultipliers;
						return true;
					case 'turbulenceOffsetY':
						this.motion.turbulenceOffsetY = value as number;
						return true;
				}
				return false;
			case 'altitude':
				switch (sub) {
					case 'default': this.altitude.default = value as number; return true;
					case 'min':     this.altitude.min     = value as number; return true;
					case 'max':     this.altitude.max     = value as number; return true;
				}
				return false;
			case 'parallax':
				switch (sub) {
					case 'role':
						this.setRole(value as DeviceRole);
						return true;
					case 'headingOffsetDeg':
						this.parallax.headingOffsetDeg = value as number; return true;
					case 'fovDeg':
						this.parallax.fovDeg = value as number; return true;
					case 'panoramaArcDeg':
						this.parallax.panoramaArcDeg = value as number; return true;
				}
				return false;
		}
		return false;
	}

	toJSON() {
		return {
			orbit: {
				driftRate: this.orbit.driftRate,
				major: this.orbit.major,
				minor: this.orbit.minor,
				majorMin: this.orbit.majorMin,
				majorMax: this.orbit.majorMax,
				breathePeriod: this.orbit.breathePeriod,
			},
			cruise: {
				departureDurationSec: this.cruise.departureDurationSec,
				transitDurationSec: this.cruise.transitDurationSec,
				defaultSpeed: this.cruise.defaultSpeed,
				minSpeed: this.cruise.minSpeed,
				maxSpeed: this.cruise.maxSpeed,
			},
			motion: {
				bankAngleMax: this.motion.bankAngleMax,
				bankSmoothing: this.motion.bankSmoothing,
				breathingPeriod: this.motion.breathingPeriod,
				breathingAmplitude: this.motion.breathingAmplitude,
				engineVibeFreqX: this.motion.engineVibeFreqX,
				engineVibeFreqY: this.motion.engineVibeFreqY,
				engineVibeAmp: this.motion.engineVibeAmp,
				bumpMinInterval: this.motion.bumpMinInterval,
				bumpMaxInterval: this.motion.bumpMaxInterval,
				bumpDecay: this.motion.bumpDecay,
				bumpRingFreq: this.motion.bumpRingFreq,
				bumpAmplitude: this.motion.bumpAmplitude,
				turbulenceMultipliers: { ...this.motion.turbulenceMultipliers },
				turbulenceOffsetY: this.motion.turbulenceOffsetY,
			},
			altitude: {
				default: this.altitude.default,
				min: this.altitude.min,
				max: this.altitude.max,
			},
			parallax: {
				role: this.parallax.role,
				headingOffsetDeg: this.parallax.headingOffsetDeg,
				fovDeg: this.parallax.fovDeg,
				panoramaArcDeg: this.parallax.panoramaArcDeg,
			},
		};
	}
}
