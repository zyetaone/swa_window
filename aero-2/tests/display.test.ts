import { describe, it, expect } from 'vitest';
import {
	altitudeAt,
	nightFactor,
	orbitPose,
	resolveAtmosphere,
	resolveLocalHours,
	windowView
} from '#lib/display/flight.js';
import {
	ATMOSPHERE_BANDS,
	TRANSITION_HALF_WIDTH_M,
	Location,
	inNaipCoverage,
	readPaneConfig,
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	CLIMB_PERIOD_SEC
} from '#lib/config.js';

const paramsFor = (search = '') => readPaneConfig(new URL(`http://kiosk.local/${search}`));

/** Altitude comfortably inside a band's core, away from either boundary. */
function coreAltitude(index: number): number {
	const floor = index === 0 ? 0 : ATMOSPHERE_BANDS[index - 1].topM;
	const ceil = ATMOSPHERE_BANDS[index].topM;
	if (!Number.isFinite(ceil)) return floor + TRANSITION_HALF_WIDTH_M * 4;
	return (floor + ceil) / 2;
}

// ── URL Knobs & Param Parsing ────────────────────────────────────────────────

describe('readPaneConfig', () => {
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
		const v = windowView(1_787_650_000, paramsFor());
		expect(Number.isFinite(v.lat)).toBe(true);
		expect(Number.isFinite(v.lon)).toBe(true);
		expect(Number.isFinite(v.aglM)).toBe(true);
		expect(v.aglM).toBeGreaterThanOrEqual(ALTITUDE_FLOOR_M);
		expect(v.aglM).toBeLessThanOrEqual(ALTITUDE_CEILING_M);
	});

	it('is deterministic across repeat calls with identical wall-clock time', () => {
		const t = 1_787_650_123.456;
		const p = paramsFor();
		const a = windowView(t, p);
		const b = windowView(t, p);
		expect(a).toEqual(b);
	});

	it('tiles into a continuous window across three pan yaw offsets', () => {
		const t = 1_787_650_000;
		const left = windowView(t, paramsFor('?azimuth=-120'));
		const center = windowView(t, paramsFor('?azimuth=-90'));
		const right = windowView(t, paramsFor('?azimuth=-60'));

		expect(left.lat).toBe(center.lat);
		expect(left.lon).toBe(center.lon);
		expect(left.aglM).toBe(center.aglM);
		expect(left.headingDeg).toBeCloseTo((center.headingDeg - 30 + 360) % 360, 5);
		expect(right.headingDeg).toBeCloseTo((center.headingDeg + 30) % 360, 5);
	});

	it('visits all altitude bands during the climb cycle', () => {
		const visitedBands = new Set<string>();
		const p = paramsFor();
		for (let s = 0; s < CLIMB_PERIOD_SEC; s += 10) {
			const v = windowView(s, p);
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
