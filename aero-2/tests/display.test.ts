import { describe, it, expect, vi } from 'vitest';
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
import {
	resolveLocalHours,
	nightFactor,
	sunPosition,
	duskHorizonMix,
	duskVaultMix
} from '#lib/display/world/sun.js';
import { ATMOSPHERE_BANDS } from '#lib/display/world/atmosphere.js';
import { ALTITUDE_CEILING_M, ALTITUDE_FLOOR_M } from '#lib/display/flight/orbit.js';
import { Location, inNaipCoverage, readSettings } from '#lib/settings/settings.svelte.js';

const paramsFor = (search = '') => readSettings(new URL(`http://kiosk.local/${search}`));

/**
 * The altitude at which band `index` applies exactly — the middle of its span.
 *
 * This used to hunt for a spot clear of a 200 m blend zone, because the
 * resolver held each band flat and blended only at the edges. It no longer
 * does: the curve is interpolated between band anchors across the whole
 * climb, and the anchor IS the midpoint.
 */
function coreAltitude(index: number): number {
	const floor = index === 0 ? 0 : ATMOSPHERE_BANDS[index - 1].topM;
	const ceil = ATMOSPHERE_BANDS[index].topM;
	return Number.isFinite(ceil) ? (floor + ceil) / 2 : 13_000;
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

	/**
	 * Changing place must carry everything the place DEFINES with it.
	 *
	 * `detail` is the one with teeth: it gates the US-only USGS layer, so a
	 * stale `1` after moving to Hyderabad mounts a layer with no coverage and
	 * streams 404s at the tile server for as long as the kiosk runs. Observed
	 * live. This has regressed four times, every time because a caller set
	 * place and forgot a sibling field — hence one gate, and this test on it.
	 */
	it('carries detail, floor and ceiling across a place change', () => {
		const s = paramsFor('?place=denver');
		expect(s.detail).toBe(1);

		s.setPlace(Location.hyderabad());
		expect(s.detail).toBe(0);
		expect(s.floorM).toBe(Location.hyderabad().climbFloorM);
		expect(s.ceilingM).toBe(Location.hyderabad().climbCeilingM);

		s.setPlace(Location.denver());
		expect(s.detail).toBe(1);
		expect(s.ceilingM).toBe(Location.denver().climbCeilingM);
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
	it('hits each band exactly at its anchor', () => {
		ATMOSPHERE_BANDS.forEach((band, i) => {
			const s = resolveAtmosphere(coreAltitude(i));
			expect(s.bandId).toBe(band.id);
			expect(s.fogDensity).toBeCloseTo(band.fogDensity, 12);
		});
	});

	it('is continuous with smooth transitions across climb', () => {
		const STEP = 5;
		let prev = resolveAtmosphere(0);
		for (let alt = STEP; alt <= 15_000; alt += STEP) {
			const s = resolveAtmosphere(alt);
			expect(Math.abs(s.fogDensity - prev.fogDensity)).toBeLessThan(1e-5);
			prev = s;
		}
	});

	/**
	 * The bug this replaced: values were held FLAT across each band and blended
	 * only over a 200 m boundary, so across a 0-13,000 m climb the atmosphere
	 * was constant for 11,400 m and changed over 1,600 m. 88% plateau, four
	 * cliffs, and that is what read as banding out of the window.
	 *
	 * Guarding the SHAPE, not a value: most of the climb must actually move the
	 * sky, and no single 200 m step may carry a large share of the total change.
	 */
	it('changes across most of the climb, in no single step', () => {
		const STEP = 200;
		const TOP = 13_000;
		let moving = 0;
		let steps = 0;
		let biggest = 0;
		let total = 0;
		let prev = resolveAtmosphere(0);

		for (let alt = STEP; alt <= TOP; alt += STEP) {
			const s = resolveAtmosphere(alt);
			const d = Math.abs(s.fogDensity - prev.fogDensity);
			if (d > 1e-9) moving++;
			biggest = Math.max(biggest, d);
			total += d;
			steps++;
			prev = s;
		}

		// Was 12% before; a continuous curve moves on essentially every step.
		expect(moving / steps).toBeGreaterThan(0.9);
		// Was ~23% of all change in one 200 m step.
		expect(biggest / total).toBeLessThan(0.1);
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

	/**
	 * The strip must be sampled from `altitudeAt`, the same function the dot's
	 * height comes from — NOT from a hand-drawn cosine.
	 *
	 * It used to be a cosine, and that was fine while the climb WAS a cosine.
	 * It no longer is: the profile carries a seeded wander (see
	 * ORBIT.altitudeWanderFrac) so no two days fly the same climb. A cosine
	 * strip therefore draws a curve the aircraft does not fly, and the dot sits
	 * beside it — the same "drawn from different parameters than the flight"
	 * defect as the orbit ring and its phase.
	 *
	 * The second assertion is the one with teeth: it proves the wander is big
	 * enough to matter, so this test cannot quietly pass if the wander is
	 * removed and the strip silently reverts to a cosine.
	 */
	it('draws the strip from the flown altitude, not from a cosine', () => {
		for (const place of [Location.hyderabad(), Location.denver()]) {
			const track = new FlightTrack(place.lat, place.lon, place.climbFloorM, place.climbCeilingM);
			let worstAgainstCosine = 0;

			for (let i = 0; i <= 40; i++) {
				const phase = i / 40;
				const agl = track.altitudeAt(phase * CLIMB_PERIOD_SEC);

				// The wander must never breach the envelope it wanders inside.
				expect(agl).toBeGreaterThanOrEqual(place.climbFloorM);
				expect(agl).toBeLessThanOrEqual(place.climbCeilingM);

				const norm = (agl - place.climbFloorM) / (place.climbCeilingM - place.climbFloorM);
				const cosineNorm = (1 - Math.cos(phase * Math.PI * 2)) * 0.5;
				worstAgainstCosine = Math.max(
					worstAgainstCosine,
					Math.abs(stripY(norm) - stripY(cosineNorm))
				);
			}

			expect(worstAgainstCosine).toBeGreaterThan(0.5);
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

describe('MiniMap track', () => {
	const place = Location.hyderabad();
	const M_PER_DEG_LAT = 111_320;

	/** Worst distance, in metres, from any pose on `flown` to the nearest point of `ring`. */
	function worstGapM(flown: FlightTrack, ring: [number, number][]): number {
		const cosLat = Math.cos((place.lat * Math.PI) / 180);
		let worst = 0;
		for (let i = 0; i < 180; i++) {
			const pose = flown.poseAt((i / 180) * ORBIT_PERIOD_SEC);
			let best = Infinity;
			for (const [lon, lat] of ring) {
				const dy = (lat - pose.lat) * M_PER_DEG_LAT;
				const dx = (lon - pose.lon) * M_PER_DEG_LAT * cosLat;
				best = Math.min(best, Math.hypot(dx, dy));
			}
			worst = Math.max(worst, best);
		}
		return worst;
	}

	/**
	 * The minimap must draw the track it actually flies.
	 *
	 * `phase` is not decoration. It is added to `theta`, while the ellipse's
	 * breathing radius is keyed to raw wallSec — so it shifts where the three
	 * radius bumps land RELATIVE to the angle, changing the SHAPE flown rather
	 * than merely rotating it. The minimap built its ring without phase while
	 * the marker came from the real view, so the aircraft flew beside its own
	 * drawn track. The second assertion is the bug: it must stay large, or the
	 * first assertion proves nothing.
	 */
	it('needs the same phase as the flight, or the marker leaves the ring', () => {
		const phase = daySeed(place) * Math.PI * 2;
		const args = [place.lat, place.lon, place.climbFloorM, place.climbCeilingM, 1] as const;
		const flown = new FlightTrack(...args, phase);

		expect(worstGapM(flown, flown.groundTrack())).toBeLessThan(500);
		expect(worstGapM(flown, new FlightTrack(...args).groundTrack())).toBeGreaterThan(2_000);
	});
});

describe('timezone offsets follow DST', () => {
	/**
	 * `utcOffset` was a field assigned in the constructor, and CATALOG is a
	 * static built once at module load — so the offset froze in whatever DST
	 * state the process started in. A kiosk booted in January would still report
	 * -07:00 for Denver in July, putting the sun an hour out until someone
	 * restarted it. Six of the eleven locations shift across DST.
	 */
	it('reports the offset for now, not for process start', () => {
		const denver = Location.byId('denver');
		const july = Date.UTC(2026, 6, 1);
		const january = Date.UTC(2026, 0, 15);

		const spy = vi.spyOn(Date, 'now');

		spy.mockReturnValue(july);
		const summer = denver.utcOffset;

		spy.mockReturnValue(january);
		const winter = denver.utcOffset;

		spy.mockRestore();

		expect(summer).toBe(-6); // MDT
		expect(winter).toBe(-7); // MST
	});

	it('leaves zones without DST alone', () => {
		const hyd = Location.byId('hyderabad');
		const spy = vi.spyOn(Date, 'now');
		spy.mockReturnValue(Date.UTC(2026, 6, 1));
		const summer = hyd.utcOffset;
		spy.mockReturnValue(Date.UTC(2026, 0, 15));
		const winter = hyd.utcOffset;
		spy.mockRestore();
		expect(summer).toBe(5.5);
		expect(winter).toBe(5.5);
	});

	it('derives every catalog offset from its IANA zone', () => {
		for (const place of Location.all()) {
			expect(Number.isFinite(place.utcOffset), place.id).toBe(true);
			expect(Math.abs(place.utcOffset), place.id).toBeLessThanOrEqual(14);
		}
	});
});

describe('feature locations are crossed, not orbited', () => {
	/**
	 * The Himalayas, open ocean and open desert have no centre worth looking at.
	 * Aiming inward — correct over a city, where the orbit centre is the skyline
	 * — would stare at one arbitrary patch of ground for the whole 49-minute
	 * loop. They aim along the track instead.
	 */
	const paramsFor = (place: Location) => ({
		place,
		azimuthDeg: 0,
		pitchDeg: -18,
		floorM: place.climbFloorM,
		ceilingM: place.climbCeilingM
	});

	it('classifies terrain as feature and places as city', () => {
		for (const id of ['himalayas', 'ocean', 'desert']) {
			expect(Location.byId(id).isFeature, id).toBe(true);
		}
		for (const id of ['hyderabad', 'denver', 'mumbai', 'dubai']) {
			expect(Location.byId(id).isFeature, id).toBe(false);
		}
	});

	it('every catalog entry is one kind or the other', () => {
		expect(Location.cities().length + Location.features().length).toBe(Location.all().length);
		expect(Location.features().length).toBe(3);
	});

	it('a city keeps its centre in frame; a feature does not fixate', () => {
		const city = Location.byId('denver');
		const feature = Location.byId('ocean');

		const spread = (place: Location) => {
			const targets: [number, number][] = [];
			for (let i = 0; i < 48; i++) {
				const v = calculateCameraView((i / 48) * ORBIT_PERIOD_SEC, paramsFor(place));
				targets.push([v.targetLon, v.targetLat]);
			}
			// How far the aim point wanders, relative to the place itself.
			const cos = Math.cos(place.lat * (Math.PI / 180));
			return Math.max(...targets.map(([x, y]) => Math.hypot((x - place.lon) * cos, y - place.lat)));
		};

		// The city's aim stays near its centre; the feature's sweeps much wider,
		// because it follows the aircraft's heading around the loop.
		expect(spread(feature)).toBeGreaterThan(spread(city));
	});

	it('a feature aims off the nose, a city aims across the orbit', () => {
		const off = (place: Location) => {
			const v = calculateCameraView(400, paramsFor(place));
			const d = Math.abs(v.cameraBearingDeg - v.planeHeadingDeg);
			return Math.min(d, 360 - d);
		};
		// Heading-relative aim is a fixed 90 deg off the nose by construction.
		expect(off(Location.byId('ocean'))).toBeCloseTo(90, 0);
		// Inward aim is not tied to the nose, so it differs.
		expect(Math.abs(off(Location.byId('denver')) - 90)).toBeGreaterThan(1);
	});
});

describe('atmosphere reads as altitude, not constant haze', () => {
	/**
	 * The Sky maps a band's `fogDensity` to MapLibre's `fog-ground-blend`. That
	 * mapping was `clamp(density * 2400, 0.65, 0.95)`, and the FLOOR did almost
	 * all the work: ground multiplied out to 0.24, haze 0.60, cirrus 0.48 and
	 * stratosphere 0.19 — all below 0.65, so all pinned to the same value. Only
	 * midDeck ever rose above it. The window sat in near-constant haze at every
	 * altitude, which is exactly the symptom of a band model that cannot be seen.
	 *
	 * This asserts the SHAPE the Sky depends on, at the band level: the bands
	 * must span a real range, and thin out above the deck.
	 */
	const byId = (id: string) => {
		const band = ATMOSPHERE_BANDS.find((b) => b.id === id);
		if (!band) throw new Error(`no band ${id}`);
		return band;
	};

	it('is clearest at ground and in the stratosphere, thickest at the deck', () => {
		const ground = byId('ground').fogDensity;
		const deck = byId('midDeck').fogDensity;
		const strato = byId('stratosphere').fogDensity;

		expect(deck).toBeGreaterThan(ground);
		expect(deck).toBeGreaterThan(strato);
		// and the top of the sky is the clearest air of all
		expect(strato).toBeLessThanOrEqual(ground);
	});

	it('spans enough range to be visible once mapped', () => {
		const densities = ATMOSPHERE_BANDS.map((b) => b.fogDensity);
		const min = Math.min(...densities);
		const max = Math.max(...densities);
		// A 5x spread. If this collapses, every altitude looks the same again.
		expect(max / min).toBeGreaterThan(3);
	});

	it('thins out again above the cloud deck', () => {
		// Climbing THROUGH the deck must clear, not keep thickening.
		expect(byId('cirrus').fogDensity).toBeLessThan(byId('midDeck').fogDensity);
		expect(byId('stratosphere').fogDensity).toBeLessThan(byId('cirrus').fogDensity);
	});
});

describe('sky colour', () => {
	/**
	 * The horizon's sunset mix was `(15 - elev) / 15`. That is not symmetric
	 * about the horizon and does not reach zero until the sun is 15 deg up —
	 * mid-morning. At 10 deg it still mixed 33% of a deep orange into a blue
	 * horizon, and #d96b2e over #99b8db gives #ae9ea2: grey-pink mud where a
	 * clear morning sky belongs.
	 */
	it('keeps sunset colour near the horizon, not into mid-morning', () => {
		expect(duskHorizonMix(-6)).toBeCloseTo(1, 2); // below the horizon: full
		expect(duskHorizonMix(0)).toBeGreaterThan(0.6); // at sunrise: strong
		expect(duskHorizonMix(10)).toBe(0); // mid-morning: none
		expect(duskHorizonMix(60)).toBe(0); // noon: none
	});

	it('dims the vault symmetrically at dawn and dusk', () => {
		// The sun 6 deg below the horizon looks the same going up or down.
		expect(duskVaultMix(-6)).toBeCloseTo(duskVaultMix(6), 6);
		expect(duskVaultMix(60)).toBe(0);
	});

	it('eases rather than ramping linearly', () => {
		// A linear ramp has a constant slope; an eased one is slowest at the ends.
		const midSlope = duskHorizonMix(1) - duskHorizonMix(3);
		const endSlope = duskHorizonMix(6) - duskHorizonMix(8);
		expect(midSlope).toBeGreaterThan(endSlope);
	});

	it('is monotonic — the sky never brightens as the sun sets', () => {
		let prev = duskHorizonMix(-12);
		for (let e = -11; e <= 20; e++) {
			const v = duskHorizonMix(e);
			expect(v).toBeLessThanOrEqual(prev + 1e-9);
			prev = v;
		}
	});
});

describe('mean ground elevation is not a terrain clearance', () => {
	/**
	 * `place.groundElevationM` is one number for a whole region. Measured against
	 * the real terrarium DEM across each orbit (+-0.3 deg at z9), mean + floor
	 * sits BELOW the local peak at five of the eleven locations — Las Vegas by
	 * 2072 m, Dubai by 1119 m, Mumbai by 990 m.
	 *
	 * The MapLibre camera is safe because it asks the renderer for the ground
	 * under the aircraft and uses the mean only as a floor. This test exists so
	 * that if anyone reverts to `aglM + groundElevationM`, or writes a second
	 * engine that does (the Cesium path currently does), the reason is on record
	 * rather than rediscovered from a screenshot of a hillside.
	 */
	it('records the locations where mean + floor is below real terrain', () => {
		// Peaks measured from the DEM, not looked up — see the commit for method.
		const measuredPeakM: Record<string, number> = {
			mumbai: 1500,
			dubai: 1724,
			las_vegas: 3592,
			phoenix: 2373,
			ocean: 1213
		};

		for (const [id, peak] of Object.entries(measuredPeakM)) {
			const place = Location.byId(id);
			const meanBased = place.groundElevationM + place.climbFloorM;
			expect(meanBased, `${id}: mean+floor should be known-unsafe`).toBeLessThan(peak);
		}
	});

	it('the places we call high-terrain do clear their own peaks', () => {
		// Denver and the Himalayas carry floors chosen for exactly this.
		const denver = Location.byId('denver');
		expect(denver.groundElevationM + denver.climbFloorM).toBeGreaterThan(3284);

		const him = Location.byId('himalayas');
		expect(him.groundElevationM + him.climbFloorM).toBeGreaterThan(8704);
	});
});
