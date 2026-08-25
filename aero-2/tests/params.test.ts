import { describe, it, expect } from 'vitest';
import { readWindowParams } from '#lib/sim/params.js';
import { DEFAULT_PITCH_DEG, DEFAULT_WINDOW_AZIMUTH_DEG } from '#lib/config/window.js';
import { inNaipCoverage, tileTemplates } from '#lib/config/imagery.js';

const params = (search = '') => readWindowParams(new URL(`http://kiosk.local/${search}`));

describe('readWindowParams', () => {
	it('defaults to Hyderabad, the fielded kiosk home', () => {
		expect(params().place.id).toBe('hyderabad');
		expect(params('?place=denver').place.id).toBe('denver');
	});

	it('falls back on an unknown place rather than throwing', () => {
		expect(params('?place=atlantis').place.id).toBe('hyderabad');
	});

	it('reads numeric knobs', () => {
		const p = params('?azimuth=90&pitch=-30&shade=0&floor=2500&ceiling=9000');
		expect(p.azimuthDeg).toBe(90);
		expect(p.pitchDeg).toBe(-30);
		expect(p.shade).toBe(0);
		expect(p.floorM).toBe(2500);
		expect(p.ceilingM).toBe(9000);
	});

	it('never yields NaN — a NaN azimuth is a black screen with no error', () => {
		for (const search of ['?azimuth=abc', '?azimuth=', '?azimuth=NaN', '?azimuth=Infinity']) {
			expect(params(search).azimuthDeg).toBe(DEFAULT_WINDOW_AZIMUTH_DEG);
		}
		expect(params('?pitch=junk').pitchDeg).toBe(DEFAULT_PITCH_DEG);
		expect(Number.isFinite(params('?floor=x&ceiling=y&shade=z&detail=w').floorM)).toBe(true);
	});

	it('turns the US-only detail layer off outside NAIP coverage', () => {
		expect(params().detail).toBe(0); // Hyderabad
		expect(params('?place=denver').detail).toBe(1);
	});

	it('lets ?detail override coverage, so the GIBS floor is inspectable anywhere', () => {
		expect(params('?place=denver&detail=0').detail).toBe(0);
	});

	it('takes the climb envelope from the place when not overridden', () => {
		const denver = params('?place=denver');
		expect(denver.floorM).toBe(3_000);
		expect(params().floorM).toBe(400);
	});
});

describe('inNaipCoverage', () => {
	it('accepts the contiguous US and rejects elsewhere', () => {
		expect(inNaipCoverage({ lat: 39.7, lon: -104.9 })).toBe(true);
		expect(inNaipCoverage({ lat: 17.4, lon: 78.5 })).toBe(false);
	});
});

describe('tileTemplates', () => {
	it('routes every layer through the local tile server, never an upstream host', () => {
		for (const tpl of Object.values(tileTemplates()).flat()) {
			expect(tpl).toContain('/api/tiles/');
			expect(tpl).not.toMatch(/amazonaws|earthdata|nationalmap/);
		}
	});
});
