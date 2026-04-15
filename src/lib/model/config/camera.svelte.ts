/**
 * CameraConfig — how we look at the map.
 *
 * Covers: orbit geometry, cruise transition timing, motion/turbulence feel,
 * and the multi-Pi parallax role (Phase 7). Every field is admin-push-mutable.
 */

export type DeviceRole = 'solo' | 'left' | 'center' | 'right';

export class OrbitConfig {
	/** Flight drift (degrees per second at speed=1.0). */
	driftRate = $state(0.01);
	/** Ellipse long/short axes (degrees). */
	major = $state(0.15);
	minor = $state(0.06);
	/** Dynamic breathing bounds + period. */
	majorMin = $state(0.08);
	majorMax = $state(0.25);
	breathePeriod = $state(180);
}

export class CruiseConfig {
	/** Warp ramp-up duration (seconds). */
	departureDurationSec = $state(2.0);
	/** Transit duration before arrival (seconds). */
	transitDurationSec = $state(2.0);
	/** Default flight speed multiplier. */
	defaultSpeed = $state(1.4);
	minSpeed = $state(0.1);
	maxSpeed = $state(3.0);
}

export class MotionConfig {
	/** Banking tilt during orbit turns. */
	bankAngleMax  = $state(6.0);
	bankSmoothing = $state(2.5);

	/** Breathing oscillation. */
	breathingPeriod    = $state(22);
	breathingAmplitude = $state(1.5);

	/** Engine micro-vibration. */
	engineVibeFreqX = $state(7);
	engineVibeFreqY = $state(11);
	engineVibeAmp   = $state(0.35);

	/** Turbulence bumps. */
	bumpMinInterval = $state(30);
	bumpMaxInterval = $state(120);
	bumpDecay       = $state(8);
	bumpRingFreq    = $state(15);
	bumpAmplitude   = $state(3);

	/** Turbulence multipliers per severity level. */
	turbulenceMultipliers = $state({ severe: 3, moderate: 1.5, light: 1 });

	/** Vertical motion scaling multiplier applied to turbulence base signal. */
	turbulenceOffsetY = $state(0.05);
}

export class AltitudeConfig {
	default = $state(35_000);
	min     = $state(10_000);
	max     = $state(65_000);
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
		const [head, sub, ...rest] = path.split('.');
		const joinRest = rest.join('.');
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
		// Unused — reserved for future deep paths.
		void joinRest;
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
