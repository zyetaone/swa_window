import { describe, it, expect } from 'vitest';
import {
	altitudeAt,
	orbitPose,
	groundTrack,
	ORBIT,
	ORBIT_PERIOD_SEC,
	BREATHE_PERIOD_SEC,
	FlightTrack,
	daySeed,
	CLIMB_PERIOD_SEC
} from '#lib/display/flight/orbit.js';
import { calculateCameraView, FlightCamera } from '#lib/display/flight/view.js';
import { resolveAtmosphere } from '#lib/display/world/atmosphere.js';
import { resolveLocalHours, nightFactor, sunPosition } from '#lib/display/world/sun.js';
import { ATMOSPHERE_BANDS, TRANSITION_HALF_WIDTH_M } from '#lib/display/world/atmosphere.js';
import { ALTITUDE_CEILING_M, ALTITUDE_FLOOR_M } from '#lib/display/flight/orbit.js';
import { Location, inNaipCoverage, readSettings } from '#lib/settings/settings.svelte.js';

const paramsFor = (search = '') => readSettings(new URL(`http://kiosk.local/${search}`));

/**
 * An altitude squarely inside band `index`, clear of the blend zone at either
 * edge.
 *
 * The midpoint is NOT good enough: the ground band spans 0–1000 m, so its
 * midpoint is 500 m, but blending starts at `topM - TRANSITION_HALF_WIDTH_M`
 * = 400 m. The midpoint therefore sits inside the transition and legitimately
 * reports a `nextBandId`. Step in from the top edge instead, and fall back to
 * the midpoint only when the band is too narrow for that to be inside it.
 */
function coreAltitude(index: number): number {
	const floor = index === 0 ? 0 : ATMOSPHERE_BANDS[index - 1].topM;
	const ceil = ATMOSPHERE_BANDS[index].topM;
	if (!Number.isFinite(ceil)) return floor + TRANSITION_HALF_WIDTH_M * 4;

	// Just below where the blend into the next band begins.
	const belowBlend = ceil - TRANSITION_HALF_WIDTH_M * 1.5;
	return belowBlend > floor ? belowBlend : (floor + ceil) / 2;
}

// ── URL Knobs & Param Parsing ────────────────────────────────────────────────

describe('readSettings', () => {
	it('defaults to Hyderabad, the fielded kiosk home', () => {
		expect(paramsFor().place.id).toBe('hyderabad');
		expect(paramsFor('?place=denver').place.id).toBe('denver');
	});

	it('falls back on an unknown place rather than throwing', () => {
		expect(paramsFor('?place=atlantis').place.id).toBe('hyderabad');
	});

	it('reads azimuth & pitch overrides', () => {
		const p = paramsFor('?azimuth=45&pitch=-30');
		expect(p.azimuthDeg).toBe(45);
		expect(p.pitchDeg).toBe(-30);
	});

	it('auto-enables detail over US locations in NAIP coverage', () => {
		expect(inNaipCoverage(Location.denver())).toBe(true);
		expect(inNaipCoverage(Location.hyderabad())).toBe(false);
		expect(paramsFor('?place=denver').detail).toBe(1);
		expect(paramsFor('?place=hyderabad').detail).toBe(0);
	});
});

// ── Flight Pose & Determinism ────────────────────────────────────────────────

describe('Flight Pose', () => {
	it('produces finite, in-range numbers', () => {
		const v = calculateCameraView(1_787_650_000, paramsFor());
		expect(Number.isFinite(v.lat)).toBe(true);
		expect(Number.isFinite(v.lon)).toBe(true);
		expect(Number.isFinite(v.aglM)).toBe(true);
		expect(v.aglM).toBeGreaterThanOrEqual(ALTITUDE_FLOOR_M);
		expect(v.aglM).toBeLessThanOrEqual(ALTITUDE_CEILING_M);
	});

	it('is deterministic across repeat calls with identical wall-clock time', () => {
		const t = 1_787_650_123.456;
		const p = paramsFor();
		const a = calculateCameraView(t, p);
		const b = calculateCameraView(t, p);
		expect(a).toEqual(b);
	});

	it('tiles into a continuous window across three pan yaw offsets', () => {
		const t = 1_787_650_000;
		const left = calculateCameraView(t, paramsFor('?azimuth=-120'));
		const center = calculateCameraView(t, paramsFor('?azimuth=-90'));
		const right = calculateCameraView(t, paramsFor('?azimuth=-60'));

		expect(left.lat).toBe(center.lat);
		expect(left.lon).toBe(center.lon);
		expect(left.aglM).toBe(center.aglM);
		expect(left.cameraBearingDeg).toBeCloseTo((center.cameraBearingDeg - 30 + 360) % 360, 5);
		expect(right.cameraBearingDeg).toBeCloseTo((center.cameraBearingDeg + 30) % 360, 5);
	});

	it('visits all altitude bands during the climb cycle', () => {
		const visitedBands = new Set<string>();
		const p = paramsFor();
		for (let s = 0; s < CLIMB_PERIOD_SEC; s += 10) {
			const v = calculateCameraView(s, p);
			const atmo = resolveAtmosphere(v.aglM);
			visitedBands.add(atmo.bandId);
		}
		expect(visitedBands.size).toBe(ATMOSPHERE_BANDS.length);
	});
});

// ── Atmosphere & Night Curves ────────────────────────────────────────────────

describe('resolveAtmosphere', () => {
	it('returns each band verbatim in its core, with no blending', () => {
		ATMOSPHERE_BANDS.forEach((band, i) => {
			const s = resolveAtmosphere(coreAltitude(i));
			expect(s.bandId).toBe(band.id);
			expect(s.nextBandId).toBeNull();
			expect(s.crossing).toBe(0);
			expect(s.fogDensity).toBe(band.fogDensity);
			expect(s.groundDetail).toBe(band.groundDetail);
			expect(s.deckOpacity).toBe(band.deckOpacity);
		});
	});

	it('is continuous with smooth transitions across climb', () => {
		const STEP = 5;
		let prev = resolveAtmosphere(0);
		for (let alt = STEP; alt <= 15_000; alt += STEP) {
			const s = resolveAtmosphere(alt);
			expect(Math.abs(s.groundDetail - prev.groundDetail)).toBeLessThan(0.01);
			expect(Math.abs(s.deckOpacity - prev.deckOpacity)).toBeLessThan(0.01);
			expect(Math.abs(s.fogDensity - prev.fogDensity)).toBeLessThan(1e-5);
			prev = s;
		}
	});

	it('darkens sky monotonically with altitude', () => {
		const alts = ATMOSPHERE_BANDS.map((_, i) => coreAltitude(i));
		const luma = alts.map((a) => {
			const [r, g, b] = resolveAtmosphere(a).skyTop;
			return r + g + b;
		});
		for (let i = 1; i < luma.length; i++) expect(luma[i]).toBeLessThan(luma[i - 1]);
	});
});

describe('nightFactor', () => {
	it('returns 0 at midday and 1 deep in night', () => {
		expect(nightFactor(12)).toBe(0);
		expect(nightFactor(23)).toBe(1);
	});

	it('ramps smoothly through dusk', () => {
		const midDusk = nightFactor(19.5);
		expect(midDusk).toBeGreaterThan(0.3);
		expect(midDusk).toBeLessThan(0.8);
	});
});

// ── Solar position ───────────────────────────────────────────────────────────

describe('sunPosition', () => {
	// Hyderabad, and a wall-clock second chosen to land on local noon there.
	const HYD_LAT = 17.385;
	const HYD_OFFSET = 5.5;
	/** UTC seconds for a date at 12:00 local (06:30 UTC) in Hyderabad. */
	const localNoon = (isoDate: string) => Date.parse(`${isoDate}T06:30:00Z`) / 1000;

	it('puts the sun high and roughly south at local noon in June', () => {
		// Northern-hemisphere summer: sun is north of the zenith at this latitude,
		// so the bearing swings past 180. Elevation is what matters here.
		const { elevationDeg } = sunPosition(localNoon('2026-06-21'), HYD_LAT, HYD_OFFSET);
		expect(elevationDeg).toBeGreaterThan(80);
	});

	it('is below the horizon at local midnight', () => {
		const midnight = Date.parse('2026-06-21T18:30:00Z') / 1000;
		expect(sunPosition(midnight, HYD_LAT, HYD_OFFSET).elevationDeg).toBeLessThan(0);
	});

	it('rises in the east and sets in the west', () => {
		const day = '2026-03-21';
		const morning = Date.parse(`${day}T03:00:00Z`) / 1000; // 08:30 local
		const evening = Date.parse(`${day}T11:30:00Z`) / 1000; // 17:00 local
		expect(sunPosition(morning, HYD_LAT, HYD_OFFSET).azimuthDeg).toBeLessThan(180);
		expect(sunPosition(evening, HYD_LAT, HYD_OFFSET).azimuthDeg).toBeGreaterThan(180);
	});

	it('is deterministic — the same second gives the same sun', () => {
		// Three Pis derive the sun independently; if this drifts, the panorama
		// seam shows two different shadow directions.
		const t = localNoon('2026-01-15');
		expect(sunPosition(t, HYD_LAT, HYD_OFFSET)).toEqual(sunPosition(t, HYD_LAT, HYD_OFFSET));
	});
});

// ── Minimap ground track ─────────────────────────────────────────────────────

describe('groundTrack', () => {
	it('closes the ring so the drawn loop has no seam', () => {
		const ring = groundTrack(17.385, 78.4867);
		expect(ring.length).toBeGreaterThan(3);
		expect(ring[0]).toEqual(ring[ring.length - 1]);
	});

	it('stays within the orbit extent around the place', () => {
		const lat = 17.385;
		const lon = 78.4867;
		// majorMax 0.25 deg north-south; east-west is aspect x that, then
		// widened again by 1/cos(lat).
		const maxLon = (0.25 * ORBIT.aspect) / Math.cos((lat * Math.PI) / 180) + 0.02;
		for (const [x, y] of groundTrack(lat, lon)) {
			expect(Math.abs(y - lat)).toBeLessThan(0.27);
			expect(Math.abs(x - lon)).toBeLessThan(maxLon);
		}
	});

	it('traces the path actually flown, not a re-derived ellipse', () => {
		// Each sample must equal orbitPose at the same instant, or the drawn loop
		// and the flown loop can drift apart without anything failing.
		const ring = groundTrack(17.385, 78.4867, 0, 8);
		for (let i = 0; i < 8; i++) {
			const p = orbitPose((i / 8) * ORBIT_PERIOD_SEC, 17.385, 78.4867);
			expect(ring[i][0]).toBeCloseTo(p.lon, 10);
			expect(ring[i][1]).toBeCloseTo(p.lat, 10);
		}
	});

	it('is deterministic, so three panes draw the same loop', () => {
		expect(groundTrack(39.7392, -104.9903)).toEqual(groundTrack(39.7392, -104.9903));
	});
});

describe('orbit shape', () => {
	it('breathes a whole number of times per circuit, so the loop closes', () => {
		expect(Number.isInteger(ORBIT.petals)).toBe(true);
		expect(BREATHE_PERIOD_SEC * ORBIT.petals).toBeCloseTo(ORBIT_PERIOD_SEC, 6);
	});

	it('returns to its own start after one period', () => {
		// The real seam test: not that we appended point 0, but that the maths
		// actually comes back. A non-integer petal count fails this.
		const a = orbitPose(0, 17.385, 78.4867);
		const b = orbitPose(ORBIT_PERIOD_SEC, 17.385, 78.4867);
		expect(b.lat).toBeCloseTo(a.lat, 9);
		expect(b.lon).toBeCloseTo(a.lon, 9);
	});

	it('reads as an ellipse, not a flower', () => {
		// Radius swing stays gentle. At 3x it looked like a spirograph.
		expect(ORBIT.majorMax / ORBIT.majorMin).toBeLessThan(1.6);
	});
});

describe('flight direction', () => {
	it('reversing mirrors the path, so the loop is flown the other way', () => {
		const fwd = new FlightTrack(17.385, 78.4867);
		const rev = fwd.reversed();
		const t = 400;
		const a = fwd.poseAt(t);
		const b = rev.poseAt(t);
		// theta is negated. dLat is a sine of theta so it mirrors; dLon is a
		// cosine so it is unchanged. Same ground track, walked the other way.
		expect(b.lat - 17.385).toBeCloseTo(-(a.lat - 17.385), 9);
		expect(b.lon - 78.4867).toBeCloseTo(a.lon - 78.4867, 9);
	});

	it('heading follows the reversed velocity, not the forward one', () => {
		const fwd = new FlightTrack(17.385, 78.4867);
		const rev = fwd.reversed();
		// A plane flying the same loop backwards must not report the same heading.
		expect(rev.poseAt(400).headingDeg).not.toBeCloseTo(fwd.poseAt(400).headingDeg, 3);
	});

	it('reversing twice returns the original direction', () => {
		expect(new FlightTrack(1, 2).reversed().reversed().direction).toBe(1);
	});
});

describe('orbit shape is an ellipse with gentle bumps', () => {
	it('is wider than it is tall', () => {
		expect(ORBIT.aspect).toBeGreaterThan(1);
	});

	it('breathes only slightly, so it reads as an orbit not a flower', () => {
		expect(ORBIT.majorMax / ORBIT.majorMin).toBeLessThan(1.2);
	});

	it('climbs and descends rather than holding one altitude', () => {
		const t = new FlightTrack(17.385, 78.4867);
		const alts = Array.from({ length: 40 }, (_, i) => t.altitudeAt((i / 40) * CLIMB_PERIOD_SEC));
		expect(Math.max(...alts) - Math.min(...alts)).toBeGreaterThan(5_000);
	});
});

describe('the window looks at the city', () => {
	/**
	 * The camera bearing used to be `planeHeading + azimuth`, a fixed offset off
	 * the nose. On an ellipse that points INWARD on one side of the loop and
	 * OUTWARD on the other, so for half of every circuit the window showed empty
	 * countryside instead of the city it is supposed to be flying around.
	 */
	it('keeps the target near the city for the whole orbit', () => {
		const place = Location.hyderabad();
		const params = {
			place,
			azimuthDeg: 0,
			pitchDeg: -18,
			floorM: place.climbFloorM,
			ceilingM: place.climbCeilingM
		};

		let worst = 0;
		for (let i = 0; i < 60; i++) {
			const v = calculateCameraView((i / 60) * ORBIT_PERIOD_SEC, params);
			const dLat = v.targetLat - place.lat;
			const dLon = (v.targetLon - place.lon) * Math.cos(place.lat * (Math.PI / 180));
			worst = Math.max(worst, Math.hypot(dLat, dLon));
		}
		// The honest comparison is against the old behaviour, not a bare number:
		// the same sweep aimed 90 deg off the nose. Inward aiming must keep the
		// target markedly closer to the city than heading-relative aiming did.
		let worstOffNose = 0;
		for (let i = 0; i < 60; i++) {
			const wallSec = (i / 60) * ORBIT_PERIOD_SEC;
			const pose = new FlightTrack(
				place.lat,
				place.lon,
				place.climbFloorM,
				place.climbCeilingM
			).poseAt(wallSec);
			const cam = new FlightCamera(90, -18).viewOptions(pose); // no centre => off-nose
			const dLat = cam.targetLat - place.lat;
			const dLon = (cam.targetLon - place.lon) * Math.cos(place.lat * (Math.PI / 180));
			worstOffNose = Math.max(worstOffNose, Math.hypot(dLat, dLon));
		}
		expect(worst).toBeLessThan(worstOffNose);
	});

	it('aims across the orbit, not along the aircraft nose', () => {
		const place = Location.hyderabad();
		const v = calculateCameraView(400, {
			place,
			azimuthDeg: 0,
			pitchDeg: -18,
			floorM: place.climbFloorM,
			ceilingM: place.climbCeilingM
		});
		// The plane's own heading is tangential; the camera should not match it.
		const diff = Math.abs(v.cameraBearingDeg - v.planeHeadingDeg);
		expect(Math.min(diff, 360 - diff)).toBeGreaterThan(30);
	});
});

describe('banking', () => {
	const track = (dir: 1 | -1 = 1) => new FlightTrack(17.385, 78.4867, 400, 13_000, dir);

	it('banks INTO the turn both ways round, never outward', () => {
		// The inside wing drops whichever direction the loop is flown. Reversing
		// mirrors the sign; it must not produce "outward" bank on one leg.
		const fwd = track(1);
		const rev = track(-1);
		for (let i = 1; i < 12; i++) {
			const t = (i / 12) * ORBIT_PERIOD_SEC;
			expect(Math.sign(fwd.poseAt(t).bankDeg)).not.toBe(Math.sign(rev.poseAt(t).bankDeg));
		}
	});

	it('rolls most where the ellipse is tightest', () => {
		// The orbit is wider than tall, so the TIGHT turns are at theta = +-PI/2
		// (the east and west ends of the long axis) and theta = 0 is the gentle
		// side. Getting this backwards made every sample saturate at max roll.
		const t = track();
		const a = ORBIT.majorMin;
		const b = a * ORBIT.aspect;
		expect(Math.abs(t.bankAt(Math.PI / 2, a, b))).toBeGreaterThan(Math.abs(t.bankAt(0, a, b)));
	});

	it('stays within a comfortable roll', () => {
		const t = track();
		for (let i = 0; i < 80; i++) {
			expect(Math.abs(t.poseAt((i / 80) * ORBIT_PERIOD_SEC).bankDeg)).toBeLessThanOrEqual(
				ORBIT.maxBankDeg + 1e-9
			);
		}
	});
});

describe('altitude profile', () => {
	it('rises and falls rather than holding one height', () => {
		// Seen as a section through the path, the loop must have hills.
		const t = new FlightTrack(17.385, 78.4867, 400, 13_000);
		const alts = Array.from({ length: 60 }, (_, i) => t.altitudeAt((i / 60) * CLIMB_PERIOD_SEC));
		expect(Math.max(...alts) - Math.min(...alts)).toBeGreaterThan(10_000);
		// and it is smooth: no step between neighbouring samples
		for (let i = 1; i < alts.length; i++) {
			expect(Math.abs(alts[i] - alts[i - 1])).toBeLessThan(1_500);
		}
	});
});

describe('daySeed', () => {
	it('is stable within a day, so three panes fly the same orbit', () => {
		const place = Location.hyderabad();
		const now = Date.UTC(2026, 7, 25, 9, 0, 0);
		const later = Date.UTC(2026, 7, 25, 21, 30, 0);
		expect(daySeed(place, now)).toBe(daySeed(place, later));
	});

	it('changes between days, so the orbit is not pinned forever', () => {
		const place = Location.hyderabad();
		expect(daySeed(place, Date.UTC(2026, 7, 25))).not.toBe(daySeed(place, Date.UTC(2026, 7, 26)));
	});

	it('differs by place', () => {
		const now = Date.UTC(2026, 7, 25);
		expect(daySeed(Location.hyderabad(), now)).not.toBe(daySeed(Location.denver(), now));
	});

	it('is a unit interval', () => {
		for (let d = 0; d < 40; d++) {
			const v = daySeed(Location.denver(), Date.UTC(2026, 0, 1) + d * 86_400_000);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe('elevation strip normalisation', () => {
	/**
	 * The minimap's altitude dot is placed by normalising AGL into 0..1 and the
	 * curve behind it is drawn from the same cosine. If the dot normalises
	 * against the GLOBAL altitude constants while the aircraft actually flies
	 * the PLACE's envelope, the two disagree — and only on places whose envelope
	 * differs from the constants. Hyderabad (400..13000) matches them exactly,
	 * so the bug is invisible there and obvious over Denver (3000..13000).
	 */
	const stripY = (norm: number, h = 24) => h - norm * (h - 4) - 2;

	it('places the altitude dot on its own curve for every location', () => {
		for (const place of [Location.hyderabad(), Location.denver()]) {
			const track = new FlightTrack(place.lat, place.lon, place.climbFloorM, place.climbCeilingM);
			for (let i = 0; i <= 20; i++) {
				const phase = i / 20;
				const agl = track.altitudeAt(phase * CLIMB_PERIOD_SEC);

				// Where the dot goes: AGL normalised against THIS place's envelope.
				const norm = (agl - place.climbFloorM) / (place.climbCeilingM - place.climbFloorM);
				// Where the curve is: the raw cosine the strip is drawn from.
				const curveNorm = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;

				expect(Math.abs(stripY(norm) - stripY(curveNorm))).toBeLessThan(0.01);
			}
		}
	});

	it('would drift if normalised against the global constants', () => {
		// Guards the fix by demonstrating the bug it replaced.
		const place = Location.denver();
		const track = new FlightTrack(place.lat, place.lon, place.climbFloorM, place.climbCeilingM);
		const agl = track.altitudeAt(0);
		const wrong = (agl - ALTITUDE_FLOOR_M) / (ALTITUDE_CEILING_M - ALTITUDE_FLOOR_M);
		const right = (agl - place.climbFloorM) / (place.climbCeilingM - place.climbFloorM);
		expect(Math.abs(stripY(wrong) - stripY(right))).toBeGreaterThan(1);
	});
});
