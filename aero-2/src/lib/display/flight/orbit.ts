/**
 * Aircraft orbit kinematics, ground track, heading, and altitude climb curves.
 * Pure deterministic mathematics — rune-free and renderer-free.
 */

export const ORBIT = {
	driftRate: 3.42e-4,
	/**
	 * Orbit radius in degrees of latitude, and how much it "breathes".
	 *
	 * Was 0.08 / 0.25 — a 3.1x swing that made the ground track a flower. ~1.1x
	 * is a gentle bump: an ellipse that is not machine-perfect, not a spirograph.
	 */
	majorMin: 0.225,
	majorMax: 0.25,
	/**
	 * Breathe cycles per circuit. MUST be a whole number, or the track never
	 * returns to its own start and the drawn loop shows a seam. Low, so the
	 * bumps are broad rather than scalloped.
	 */
	petals: 3,
	/**
	 * East-west radius as a multiple of north-south. >1 is WIDER than tall.
	 * Was 0.6, which put the long axis up the short screen dimension.
	 */
	aspect: 1.7,
	/**
	 * Peak roll in degrees at the tightest part of the turn. The physically
	 * correct value here is ~3.5 deg, which nobody would notice; this is a
	 * readable exaggeration, not a simulation.
	 */
	maxBankDeg: 14,

	/**
	 * How far the altitude wanders off the clean climb curve, as a fraction of
	 * the floor-to-ceiling band. A real airliner does not trace a cosine; it
	 * holds, drifts, and steps. Tapered to zero at both ends of the band so it
	 * can never breach the floor or the ceiling.
	 */
	altitudeWanderFrac: 0.08,

	/**
	 * How much the ellipse itself deviates, as a fraction of its radius. Keyed
	 * to THETA rather than to time, so the loop still closes on itself — a
	 * time-keyed wobble would leave a seam where the track met its own start.
	 */
	pathWanderFrac: 0.06,
	flightSpeed: 6.0
} as const;

/**
 * One full circuit of the orbit, in seconds.
 * `theta` advances by `driftRate * 2π` per second (~49 minutes).
 */
export const ORBIT_PERIOD_SEC = 1 / ORBIT.driftRate;

/**
 * The breathe cycle, derived from the orbit to guarantee the loop closes without seams.
 */
export const BREATHE_PERIOD_SEC = ORBIT_PERIOD_SEC / ORBIT.petals;

export const ALTITUDE_FLOOR_M = 400;
export const ALTITUDE_CEILING_M = 13_000;
export const CLIMB_PERIOD_SEC = 900;

const TWO_PI = Math.PI * 2;
const M_PER_DEG_LAT = 111_320;

export function normalizeHeading(deg: number): number {
	return ((deg % 360) + 360) % 360;
}

export interface OrbitPose {
	lat: number;
	lon: number;
	headingDeg: number;
	aglM: number;
	/**
	 * Bank angle, degrees. Negative rolls left (left wing down).
	 *
	 * An aircraft banks INTO its turn — the inside wing drops, whichever way it
	 * is going. Flying the loop in reverse mirrors the sign, it does not remove
	 * it, and level flight is only ever momentary on a curved path.
	 */
	bankDeg: number;
}

/**
 * A small, stable per-day offset so the orbit is not pinned to the same patch
 * of ground forever.
 *
 * Deterministic on purpose. Three Pis form one window and never talk to each
 * other about pose, so the offset must be a pure function of the day and the
 * place — `Math.random()` would give each pane a different orbit and split the
 * wall into three unrelated views.
 */
export function daySeed(place: { lat: number; lon: number }, nowMs = Date.now()): number {
	const day = Math.floor(nowMs / 86_400_000);
	let h =
		(day * 2654435761) ^
		(Math.round(place.lat * 1000) * 40503) ^
		(Math.round(place.lon * 1000) * 65537);
	h = Math.imul(h ^ (h >>> 15), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * FlightTrack — ES6 domain model representing an orbital trajectory around a ground center.
 */
export class FlightTrack {
	constructor(
		readonly centerLat: number,
		readonly centerLon: number,
		readonly floorM: number = ALTITUDE_FLOOR_M,
		readonly ceilingM: number = ALTITUDE_CEILING_M,
		/** +1 flies the loop one way, -1 the other. */
		readonly direction: 1 | -1 = 1,
		/**
		 * Phase offset in radians, so the loop does not start from the same point
		 * (and sit over the same ground) every launch. Comes from `daySeed`, so it
		 * is stable across a day and identical on all three panes.
		 */
		readonly phase = 0
	) {}

	/** The same track flown the other way round. */
	reversed(): FlightTrack {
		return new FlightTrack(
			this.centerLat,
			this.centerLon,
			this.floorM,
			this.ceilingM,
			this.direction === 1 ? -1 : 1,
			this.phase
		);
	}

	/**
	 * Compute 3D aircraft orbital position, heading, and altitude at wall-clock second `wallSec`.
	 */
	poseAt(wallSec: number): OrbitPose {
		const breathePhase = (wallSec % BREATHE_PERIOD_SEC) / BREATHE_PERIOD_SEC;
		const orbitPhase = (wallSec % ORBIT_PERIOD_SEC) / ORBIT_PERIOD_SEC;

		// Harmonic dynamic motion noise (rich multi-frequency organic waves)
		const harmonic =
			Math.sin(orbitPhase * TWO_PI * 4) * 0.08 + Math.cos(orbitPhase * TWO_PI * 8) * 0.04;
		const breathe = Math.max(
			0,
			Math.min(1, (1 - Math.cos(breathePhase * TWO_PI)) * 0.5 + harmonic)
		);

		const theta = (wallSec * ORBIT.driftRate * TWO_PI * this.direction + this.phase) % TWO_PI;

		/**
		 * Deviate the ellipse itself, so the ground track is not a perfect oval.
		 *
		 * Two properties this has to keep, both of which are load-bearing and
		 * both of which a naive version breaks:
		 *
		 * 1. Keyed to THETA, not to time. At theta and theta+2*PI the wobble is
		 *    the same, so the loop closes exactly on itself; a time-keyed one
		 *    drifts and leaves a seam on the minimap where the track misses its
		 *    own start.
		 * 2. EVEN in theta — pure cosines, with the seed in the AMPLITUDE rather
		 *    than inside the argument. Reversing the loop negates theta, and the
		 *    reversed flight must trace the same ground track backwards. With
		 *    `sin(2*theta + seed)` it does not, and the mirror test catches it.
		 */
		const blend = Math.cos(this.phase * 5.3);
		// |shape| <= |blend| + (1 - |blend|) = 1, by construction.
		const shape = Math.cos(theta * 2) * blend + Math.cos(theta * 3) * (1 - Math.abs(blend));
		// Maps to [1 - pathWanderFrac, 1]: the wobble only ever draws the track
		// IN, never out, so `majorMax` stays a true bound on the orbit extent.
		const wobble = 1 - ORBIT.pathWanderFrac * (1 + shape) * 0.5;

		const a = (ORBIT.majorMin + (ORBIT.majorMax - ORBIT.majorMin) * breathe) * wobble;
		const b = a * ORBIT.aspect;
		const cosLat = Math.cos((this.centerLat * Math.PI) / 180);

		const dLat = a * Math.sin(theta);
		const dLon = (b * Math.cos(theta)) / (cosLat || 1);

		const vx = ((b * -Math.sin(theta)) / (cosLat || 1)) * 111_320 * this.direction;
		const vy = a * Math.cos(theta) * M_PER_DEG_LAT * this.direction;
		const headingDeg = normalizeHeading(90 - (Math.atan2(vy, vx) * 180) / Math.PI);

		const aglM = this.altitudeAt(wallSec);

		return {
			lat: this.centerLat + dLat,
			lon: this.centerLon + dLon,
			headingDeg,
			aglM,
			bankDeg: this.bankAt(theta, a, b)
		};
	}

	/**
	 * Bank angle for the turn being flown at `theta`.
	 *
	 * Shape is honest: bank follows v^2 / r, so the aircraft rolls MOST where the
	 * ellipse is tightest (the ends of the long axis) and is near level on the
	 * gentle sides. It banks INTO the turn either way round — the inside wing
	 * drops whether the loop is flown clockwise or anticlockwise, which is why
	 * the sign follows `direction` rather than flipping to "outward".
	 *
	 * Magnitude is NOT honest, and deliberately so: at this speed and radius the
	 * true bank is 0.25-3.5 degrees, which is invisible out of a window. Scaled
	 * to something a passenger would actually feel, and capped so it never looks
	 * like aerobatics.
	 */
	bankAt(theta: number, a: number, b: number): number {
		const sin = Math.sin(theta);
		const cos = Math.cos(theta);
		// Curvature of the ellipse at this angle, normalised to its own maximum.
		const denom = Math.pow(a * a * sin * sin + b * b * cos * cos, 1.5);
		const curvature = denom === 0 ? 0 : (a * b) / denom;
		// With b > a (a wide ellipse) the TIGHTEST turn is at theta = +-PI/2,
		// the ends of the long east-west axis, where curvature peaks at b/a^2.
		// Normalising against a/b^2 instead saturated every sample at max roll.
		const maxCurvature = Math.max(a, b) / Math.pow(Math.min(a, b), 2);
		const norm = maxCurvature === 0 ? 0 : Math.min(1, curvature / maxCurvature);
		return -this.direction * norm * ORBIT.maxBankDeg;
	}

	/**
	 * Compute altitude at wall-clock second `wallSec` along the climb/descent cosine curve.
	 */
	altitudeAt(wallSec: number): number {
		const phase = (wallSec % CLIMB_PERIOD_SEC) / CLIMB_PERIOD_SEC;
		const smooth = (1 - Math.cos(phase * TWO_PI)) * 0.5;
		const band = this.ceilingM - this.floorM;
		const base = this.floorM + band * smooth;

		/**
		 * Wander, so the climb is not a clean cosine every single cycle.
		 *
		 * Seeded from `phase`, which carries `daySeed` — NOT from Math.random or
		 * from anything relative to page load. Three Pis form one window and
		 * never exchange pose; a per-load random would give each pane its own
		 * altitude and split the wall into three unrelated views. Per-day is the
		 * strongest variation available without a sync channel.
		 *
		 * Three incommensurable periods, so the sum does not visibly repeat.
		 */
		const seed = this.phase;
		const wander =
			Math.sin(wallSec / 211 + seed * 7.1) * 0.6 +
			Math.sin(wallSec / 97 + seed * 3.7) * 0.3 +
			Math.sin(wallSec / 43 + seed * 11.3) * 0.1;

		// sin(phase*PI) is 0 at both ends of the band and 1 in the middle, so the
		// wander cannot push the aircraft through its own floor or ceiling.
		const taper = Math.sin(phase * Math.PI);
		const out = base + wander * band * ORBIT.altitudeWanderFrac * taper;
		return Math.min(this.ceilingM, Math.max(this.floorM, out));
	}

	/**
	 * Sample the closed ground track ring of [lon, lat] pairs for minimap display.
	 */
	groundTrack(wallSec = 0, samples = 240): [number, number][] {
		const ring: [number, number][] = [];
		for (let i = 0; i < samples; i++) {
			const t = wallSec + (i / samples) * ORBIT_PERIOD_SEC;
			const p = this.poseAt(t);
			ring.push([p.lon, p.lat]);
		}
		ring.push(ring[0]);
		return ring;
	}
}

export function orbitPose(
	wallSec: number,
	centerLat: number,
	centerLon: number,
	floorM: number = ALTITUDE_FLOOR_M,
	ceilingM: number = ALTITUDE_CEILING_M,
	/** +1 flies the loop one way, -1 the other. */
	direction: 1 | -1 = 1
): OrbitPose {
	return new FlightTrack(centerLat, centerLon, floorM, ceilingM).poseAt(wallSec);
}

export function altitudeAt(
	wallSec: number,
	floorM: number = ALTITUDE_FLOOR_M,
	ceilingM: number = ALTITUDE_CEILING_M
): number {
	return new FlightTrack(0, 0, floorM, ceilingM).altitudeAt(wallSec);
}

export function groundTrack(
	centerLat: number,
	centerLon: number,
	wallSec = 0,
	samples = 240
): [number, number][] {
	return new FlightTrack(centerLat, centerLon).groundTrack(wallSec, samples);
}
