import { describe, it, expect } from 'vitest';
import {
	altitudeAt,
	orbitPose,
	gateImagerySelection,
	NightLighting,
	resolveAtmosphere,
	selectDetailLevel,
	selectImagery,
	type ImagerySelection,
} from '#lib/rules.js';
import {
	ALTITUDE_CEILING_M,
	ALTITUDE_FLOOR_M,
	ATMOSPHERE_BANDS,
	CLIMB_PERIOD_SEC,
	IMAGERY_SOURCES,
	TRANSITION_HALF_WIDTH_M,
} from '#lib/assets/data.js';

/** Altitude comfortably inside a band's core, away from either boundary. */
function coreAltitude(index: number): number {
	const floor = index === 0 ? 0 : ATMOSPHERE_BANDS[index - 1].topM;
	const ceil = ATMOSPHERE_BANDS[index].topM;
	if (!Number.isFinite(ceil)) return floor + TRANSITION_HALF_WIDTH_M * 4;
	return (floor + ceil) / 2;
}

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

	it('is continuous — no visible pop anywhere in the climb', () => {
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

	it('peaks crossing at 1 exactly on a boundary and 0 in the cores', () => {
		for (const band of ATMOSPHERE_BANDS) {
			if (!Number.isFinite(band.topM)) continue;
			expect(resolveAtmosphere(band.topM).crossing).toBeCloseTo(1, 5);
		}
		expect(resolveAtmosphere(coreAltitude(2)).crossing).toBe(0);
	});

	it('gives the same state whether the altitude is reached climbing or descending', () => {
		const boundary = ATMOSPHERE_BANDS[1].topM;
		for (const offset of [-500, -100, 0, 100, 500]) {
			const a = resolveAtmosphere(boundary + offset);
			const b = resolveAtmosphere(boundary + offset);
			expect(a).toEqual(b);
		}
	});

	it('is deterministic across repeated calls — the 3-Pi wall depends on it', () => {
		const samples = [0, 999, 1_000, 4_200, 10_999, 11_000, 38_000];
		for (const alt of samples) {
			const runs = Array.from({ length: 5 }, () => resolveAtmosphere(alt));
			for (const r of runs) expect(r).toEqual(runs[0]);
		}
	});

	it('fills the frame with deck at cruise instead of leaving a void', () => {
		const cruise = resolveAtmosphere(11_600);
		expect(cruise.deckOpacity).toBeGreaterThan(0.9);
		expect(cruise.groundDetail).toBeLessThan(0.2);
	});

	it('leaves every band a core, however the heights get retuned', () => {
		const withCore = ATMOSPHERE_BANDS.map(() => false);
		for (let alt = 0; alt <= 15_000; alt += 10) {
			const s = resolveAtmosphere(alt);
			if (s.crossing === 0) {
				withCore[ATMOSPHERE_BANDS.findIndex((b) => b.id === s.bandId)] = true;
			}
		}
		ATMOSPHERE_BANDS.forEach((band, i) => {
			expect(withCore[i], `band "${band.id}" has no un-blended altitude`).toBe(true);
		});
	});

	it('clamps nonsense altitudes to the ground band rather than throwing', () => {
		for (const bad of [-1, -99_999, Number.NaN, Number.POSITIVE_INFINITY]) {
			const s = resolveAtmosphere(bad);
			expect(s.bandId).toBe(ATMOSPHERE_BANDS[0].id);
		}
	});

	it('darkens the sky monotonically with altitude', () => {
		const alts = ATMOSPHERE_BANDS.map((_, i) => coreAltitude(i));
		const luma = alts.map((a) => {
			const [r, g, b] = resolveAtmosphere(a).skyTop;
			return r + g + b;
		});
		for (let i = 1; i < luma.length; i++) expect(luma[i]).toBeLessThan(luma[i - 1]);
	});
});

const DAY = 0;
const NIGHT = 1;
const day = IMAGERY_SOURCES.find((s) => s.nightAnchor === 0)!;

describe('selectImagery', () => {
	it('picks the day source by day and the night source by night', () => {
		expect(selectImagery({ groundDetail: 1, nightFactor: DAY, current: null }).sourceId).toBe(
			'eox-sentinel2',
		);
		expect(selectImagery({ groundDetail: 1, nightFactor: NIGHT, current: null }).sourceId).toBe(
			'cartodb-dark',
		);
	});

	it('never requests deeper than the packs actually hold', () => {
		for (let g = 0; g <= 1.0001; g += 0.05) {
			for (const nf of [DAY, NIGHT]) {
				const sel = selectImagery({ groundDetail: g, nightFactor: nf, current: null });
				const src = IMAGERY_SOURCES.find((s) => s.id === sel.sourceId)!;
				expect(sel.maximumLevel).toBeGreaterThanOrEqual(src.zoomRange[0]);
				expect(sel.maximumLevel).toBeLessThanOrEqual(src.zoomRange[1]);
			}
		}
	});

	it('spends less detail at cruise than on the ground', () => {
		const low = selectImagery({
			groundDetail: resolveAtmosphere(300).groundDetail,
			nightFactor: DAY,
			current: null,
		});
		const cruise = selectImagery({
			groundDetail: resolveAtmosphere(11_600).groundDetail,
			nightFactor: DAY,
			current: null,
		});
		expect(cruise.maximumLevel).toBeLessThan(low.maximumLevel);
	});

	it('does not flip the base texture back and forth at the day/night crossover', () => {
		let current: ImagerySelection | null = selectImagery({
			groundDetail: 1,
			nightFactor: 0.45,
			current: null,
		});
		const first = current.sourceId;
		let swaps = 0;
		for (const nf of [0.5, 0.48, 0.52, 0.49, 0.51, 0.5, 0.47]) {
			const next: ImagerySelection = selectImagery({
				groundDetail: 1,
				nightFactor: nf,
				current,
			});
			if (next.sourceId !== current.sourceId) swaps++;
			current = next;
		}
		expect(swaps).toBe(0);
		expect(current.sourceId).toBe(first);
	});

	it('still swaps once night is unambiguous', () => {
		const dayPick = selectImagery({ groundDetail: 1, nightFactor: 0.1, current: null });
		const nightPick = selectImagery({ groundDetail: 1, nightFactor: 0.95, current: dayPick });
		expect(nightPick.sourceId).not.toBe(dayPick.sourceId);
	});

	it('holds the zoom cap against sub-step jitter, but yields to a real change', () => {
		const held = selectDetailLevel(day, 0.5, 8);
		expect(held).toBe(8);

		const moved = selectDetailLevel(day, 0.0, 8);
		expect(moved).toBeLessThan(8);
	});

	it('recomputes the level from scratch when the source changes under it', () => {
		const dayPick = selectImagery({ groundDetail: 0.2, nightFactor: 0.0, current: null });
		const forced: ImagerySelection = { ...dayPick, maximumLevel: 12 };
		const nightPick = selectImagery({ groundDetail: 0.2, nightFactor: 1.0, current: forced });
		expect(nightPick.sourceId).not.toBe(forced.sourceId);
		expect(nightPick.maximumLevel).toBeLessThan(12);
	});

	it('is deterministic and total — the 3-Pi wall depends on both', () => {
		for (const bad of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
			const a = selectImagery({ groundDetail: bad, nightFactor: bad, current: null });
			const b = selectImagery({ groundDetail: bad, nightFactor: bad, current: null });
			expect(a).toEqual(b);
			expect(Number.isFinite(a.maximumLevel)).toBe(true);
		}
	});
});

describe('gateImagerySelection', () => {
	const dayPick = selectImagery({ groundDetail: 1, nightFactor: 0, current: null });

	it('keeps the selection when the layer exists', () => {
		expect(gateImagerySelection(dayPick, () => true)).toEqual(dayPick);
	});

	it('falls back to eox when cartodb is missing at night', () => {
		const nightPick = selectImagery({ groundDetail: 1, nightFactor: 1, current: null });
		const gated = gateImagerySelection(nightPick, (id) => id === 'eox-sentinel2');
		expect(gated.sourceId).toBe('eox-sentinel2');
		expect(gated.urlTemplate).toBe('/api/tiles/eox-sentinel2/{z}/{y}/{x}.jpg');
	});

	it('falls back to esri when only esri is cached', () => {
		const gated = gateImagerySelection(dayPick, (id) => id === 'esri-world-imagery');
		expect(gated.sourceId).toBe('esri-world-imagery');
	});
});

describe('orbitPose', () => {
	const base = {
		centerLat: 17.385,
		centerLon: 78.4867,
		orbitAngle0: 0.5,
		orbitBearingRad: 0,
		direction: 1,
		majorMin: 0.08,
		majorMax: 0.25,
		breathePeriod: 180,
		driftRate: 0.018,
		flightSpeed: 6,
	};

	it('ignores when each Pi booted — the wall depends on it', () => {
		// Three panes, three boot times, one instant. They must agree exactly.
		const now = 1_787_650_000;
		const panes = [now - 5, now - 40, now - 3_600].map((bootT) =>
			orbitPose({ ...base, wallT: now, orbitEpochWallT: bootT }),
		);
		expect(panes[1]).toEqual(panes[0]);
		expect(panes[2]).toEqual(panes[0]);
	});

	it('stays finite and keeps moving an hour in', () => {
		const t0 = 1_787_650_000;
		const a = orbitPose({ ...base, wallT: t0, orbitEpochWallT: t0 });
		const b = orbitPose({ ...base, wallT: t0 + 3_600, orbitEpochWallT: t0 });
		for (const p of [a, b]) {
			expect(Number.isFinite(p.lat)).toBe(true);
			expect(Number.isFinite(p.lon)).toBe(true);
			expect(p.orbitAngle).toBeGreaterThanOrEqual(0);
			expect(p.orbitAngle).toBeLessThan(Math.PI * 2);
		}
		expect(b.lat).not.toBe(a.lat);
	});
});

describe('altitudeAt', () => {
	it('is absolute in wall time — three panes fly at one height', () => {
		const now = 1_787_650_000;
		expect(altitudeAt(now)).toBe(altitudeAt(now));
		// Continuous: a frame apart is centimetres apart, never a jump.
		expect(Math.abs(altitudeAt(now + 1 / 60) - altitudeAt(now))).toBeLessThan(1);
	});

	it('visits every band across one climb, so no band is unreachable', () => {
		const seen = new Set<string>();
		for (let t = 0; t < CLIMB_PERIOD_SEC; t += 5) {
			seen.add(resolveAtmosphere(altitudeAt(t)).bandId);
		}
		for (const band of ATMOSPHERE_BANDS) expect(seen).toContain(band.id);
	});

	it('stays inside the authored envelope', () => {
		for (let t = 0; t < CLIMB_PERIOD_SEC; t += 3) {
			const a = altitudeAt(t);
			expect(a).toBeGreaterThanOrEqual(ALTITUDE_FLOOR_M - 1e-6);
			expect(a).toBeLessThanOrEqual(ALTITUDE_CEILING_M + 1e-6);
		}
		expect(altitudeAt(Number.NaN)).toBe(ALTITUDE_FLOOR_M);
	});
});

describe('NightLighting', () => {
	const lighting = new NightLighting();

	it('returns 0 at midday', () => {
		expect(lighting.factor(12)).toBe(0);
	});

	it('returns 1 deep in the night', () => {
		expect(lighting.factor(23)).toBe(1);
	});

	it('ramps through dusk with a sqrt curve', () => {
		const midDusk = lighting.factor(19.5);
		expect(midDusk).toBeGreaterThan(0.3);
		expect(midDusk).toBeLessThan(0.8);
	});
});
