import { describe, it, expect } from 'vitest';
import { integrateOrbitAngle } from '#lib/flight/orbit.js';
import { resolveLocalHours } from '#lib/model/local-time.js';
import { CameraPose, GlobeSyncSlice } from '#lib/types.js';
import { globe, syncGlobe } from '#lib/world/globe.js';
import { gameLoop } from '#lib/game-loop.js';

describe('globe', () => {
	it('returns a Svelte attachment function', () => {
		expect(typeof globe()).toBe('function');
	});

	it('syncGlobe is safe before mount', () => {
		expect(() =>
			syncGlobe(
				new GlobeSyncSlice(
					new CameraPose(0, 0, 1000, 0, -10),
					{
						bandId: 'ground',
						nextBandId: null,
						crossing: 0,
						fogDensity: 1e-4,
						groundDetail: 1,
						deckOpacity: 0,
						skyTop: [0, 0, 0],
						skyHorizon: [0, 0, 0],
					},
				),
			),
		).not.toThrow();
	});
});

describe('game-loop', () => {
	it('subscribe returns an unsubscribe function', () => {
		const unsub = gameLoop.subscribe(() => {});
		expect(typeof unsub).toBe('function');
		unsub();
	});
});

describe('integrateOrbitAngle', () => {
	const base = {
		angle0: 0.5,
		a: 0.15,
		b: 0.06,
		direction: 1,
		driftRate: 0.01,
		flightSpeed: 6,
	};

	it('is deterministic for the same wall window', () => {
		const a = integrateOrbitAngle({ ...base, wallT0: 1000, wallT: 1005 });
		const b = integrateOrbitAngle({ ...base, wallT0: 1000, wallT: 1005 });
		expect(a).toBe(b);
	});
});

describe('resolveLocalHours', () => {
	it('resolves a known IANA zone', () => {
		const h = resolveLocalHours({
			timeZone: 'UTC',
			now: new Date('2026-01-15T12:00:00Z'),
		});
		expect(h).toBeCloseTo(12, 1);
	});
});
