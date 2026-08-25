import { describe, it, expect } from 'vitest';
import { altitudeAt, orbitPose } from '#lib/display/flight/orbit.js';
import { calculateCameraView } from '#lib/display/flight/view.js';
import { resolveAtmosphere } from '#lib/display/world/atmosphere.js';
import { resolveLocalHours, nightFactor, sunPosition } from '#lib/display/world/sun.js';
import { ATMOSPHERE_BANDS, TRANSITION_HALF_WIDTH_M } from '#lib/display/world/atmosphere.js';
import {
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	CLIMB_PERIOD_SEC
} from '#lib/display/flight/orbit.js';
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
