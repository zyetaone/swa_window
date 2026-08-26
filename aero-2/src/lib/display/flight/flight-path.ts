/**
 * flight-path.ts — Aircraft flight path kinematics, ground track, heading, and altitude climb curves.
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
	 * Peak roll in degrees at the tightest part of the turn.
	 * Tuned for a graceful, readable banking curve that opens up sky and ground during turns.
	 */
	maxBankDeg: 18,

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
 * One full circuit of the flight path, in seconds.
 * `theta` advances by `driftRate * 2π` per second (~49 minutes).
 */
export const ORBIT_PERIOD_SEC = 1 / ORBIT.driftRate;

/**
 * The breathe cycle, derived from the flight path to guarantee the loop closes without seams.
 */
export const BREATHE_PERIOD_SEC = ORBIT_PERIOD_SEC / ORBIT.petals;

/**
 * Turn rate that corresponds to full bank, degrees per second.
 *
 * The circuit is ~49 minutes, so the mean rate is 360/2924 = 0.123 deg/s and
 * the sharp ends of a 1.7:1 ellipse run roughly twice that. Normalising here
 * rather than against a closed form keeps the bank honest when the path is
 * tuned — change `aspect` and the roll follows without a second edit.
 */
export const TURN_RATE_REF_DEG_PER_SEC = 0.25;

/** Signed shortest difference between two bearings, -180..180. */
function normalizeSigned(deg: number): number {
	return ((((deg + 180) % 360) + 360) % 360) - 180;
}

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

export type FlightPose = OrbitPose;

/**
 * A small, stable per-day offset so the flight path is not pinned to the same patch
 * of ground forever.
 *
 * Deterministic on purpose. Three Pis form one window and never talk to each
 * other about pose, so the offset must be a pure function of the day and the
 * place — `Math.random()` would give each pane a different flight path and split the
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
 * FlightTrack — Domain model representing a flight path trajectory around a ground center.
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
	 * Compute 3D aircraft flight path position, heading, and altitude at wall-clock second `wallSec`.
	 */
	/**
	 * Where the aircraft is at `wallSec` — position only.
	 *
	 * Split out from `poseAt` so heading can be measured from the track itself
	 * rather than hand-differentiated. `a` and `b` are functions of time via
	 * `breathe` and of theta via `wobble`, so an analytic velocity that treats
	 * them as constants is missing the radial term entirely.
	 */
	positionAt(wallSec: number): { lat: number; lon: number } {
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
		 */
		const blend = Math.cos(this.phase * 5.3);
		const shape = Math.cos(theta * 2) * blend + Math.cos(theta * 3) * (1 - Math.abs(blend));
		const wobble = 1 - ORBIT.pathWanderFrac * (1 + shape) * 0.5;

		const a = (ORBIT.majorMin + (ORBIT.majorMax - ORBIT.majorMin) * breathe) * wobble;
		const b = a * ORBIT.aspect;
		const cosLat = Math.cos((this.centerLat * Math.PI) / 180);

		return {
			lat: this.centerLat + a * Math.sin(theta),
			lon: this.centerLon + (b * Math.cos(theta)) / (cosLat || 1)
		};
	}

	/**
	 * Compute 3D aircraft flight path position, heading, bank and altitude.
	 */
	poseAt(wallSec: number): OrbitPose {
		const here = this.positionAt(wallSec);
		const headingDeg = this.headingAt(wallSec);

		return {
			lat: here.lat,
			lon: here.lon,
			headingDeg,
			aglM: this.altitudeAt(wallSec),
			bankDeg: this.bankAt(wallSec)
		};
	}

	/**
	 * Heading, measured from the track rather than derived from it.
	 *
	 * The hand-derived velocity was wrong twice over. It divided the east
	 * component by cosLat AND multiplied by metres-per-degree-of-longitude at
	 * the equator, double-counting the convergence of the meridians — so the
	 * error grew with latitude. And it treated the ellipse radii as constants
	 * when both breathe with time and wobble with theta, dropping the radial
	 * velocity altogether. Measured against the actual ground track the
	 * reported heading was out by up to 27 degrees at Chicago and 21 at
	 * Hyderabad.
	 *
	 * A central difference over the real positions has neither problem, cannot
	 * drift out of sync with `positionAt` when the path is tuned, and is three
	 * lines instead of six. Two extra evaluations of a handful of trig calls,
	 * once per frame.
	 */
	headingAt(wallSec: number, dt = 0.5): number {
		const before = this.positionAt(wallSec - dt);
		const after = this.positionAt(wallSec + dt);
		const cosLat = Math.cos((this.centerLat * Math.PI) / 180) || 1;
		const dNorth = (after.lat - before.lat) * M_PER_DEG_LAT;
		const dEast = (after.lon - before.lon) * M_PER_DEG_LAT * cosLat;
		return normalizeHeading((Math.atan2(dEast, dNorth) * 180) / Math.PI);
	}

	/**
	 * Bank, from how fast the heading is actually changing.
	 *
	 * This used to evaluate the curvature of the ideal ellipse, and it had the
	 * axes transposed: the denominator paired `a` with sin and `b` with cos,
	 * which is the curvature of an ellipse rotated ninety degrees from the one
	 * being flown. With `aspect` at 1.7 the long axis runs east, so the sharp
	 * ends are at theta 0 and pi — and the aircraft rolled to its full 14
	 * degrees at theta pi/2, where the measured turn rate is at its LOWEST. The
	 * wing dropped hardest while flying straightest, and levelled through the
	 * tightest part of the turn.
	 *
	 * Deriving it from the heading rate removes the question. It also picks up
	 * the wobble and breathe terms for free, which the closed form ignored.
	 */
	bankAt(wallSec: number, dt = 1.0): number {
		const rate =
			normalizeSigned(this.headingAt(wallSec + dt) - this.headingAt(wallSec - dt)) / (2 * dt);
		const norm = Math.max(-1, Math.min(1, rate / TURN_RATE_REF_DEG_PER_SEC));
		return -norm * ORBIT.maxBankDeg;
	}

	/**
	 * Compute altitude at wall-clock second `wallSec` along the climb/descent cosine curve.
	 */
	altitudeAt(wallSec: number): number {
		const phase = (wallSec % CLIMB_PERIOD_SEC) / CLIMB_PERIOD_SEC;
		const smooth = (1 - Math.cos(phase * TWO_PI)) * 0.5;
		const band = this.ceilingM - this.floorM;
		const base = this.floorM + band * smooth;

		const seed = this.phase;
		const wander =
			Math.sin(wallSec / 211 + seed * 7.1) * 0.6 +
			Math.sin(wallSec / 97 + seed * 3.7) * 0.3 +
			Math.sin(wallSec / 43 + seed * 11.3) * 0.1;

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

/**
 * A deterministic pseudo-random value in [0,1) for a given integer slot.
 *
 * For effects that need to look random but must be IDENTICAL on all three
 * panes: lightning, gusts, anything scheduled. `Math.random()` gives each pane
 * its own answer, and on one continuous window that reads as a fault rather
 * than as weather — three panes flashing at three different moments.
 *
 * Keyed off a slot index derived from the wall clock, so every pane computes
 * the same value for the same instant without exchanging anything, and a pane
 * that reboots rejoins mid-sequence instead of restarting it.
 */
export function slotNoise(slot: number, salt = 0): number {
	let h = Math.imul(slot ^ 0x9e3779b9, 2246822507) ^ Math.imul(salt + 1, 3266489909);
	h = Math.imul(h ^ (h >>> 15), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Seeded PRNG (mulberry32) — a deterministic stream from one integer seed.
 *
 * Lives beside `daySeed` and `slotNoise` because it is the same primitive
 * serving the same invariant: three Pi 5s draw one window and exchange nothing,
 * so anything that looks random has to be a pure function of a shared seed.
 *
 * Was copied byte-for-byte into Clouds.svelte and RainGlass.svelte. Two copies
 * of a PRNG is worse than two copies of most things — if one is ever "improved"
 * the panes stop agreeing, and the symptom is a wall that looks subtly wrong
 * rather than anything that throws.
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
