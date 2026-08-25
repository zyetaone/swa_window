import { describe, it, expect } from 'vitest';
import { screenSpaceErrorFor, LodSync } from '#lib/world/sync-lod.js';
import { resolveAtmosphere } from '#lib/world/atmosphere.js';

/** Minimal stand-in for the bits of GlobeRuntime LodSync touches. */
function fakeRuntime() {
	const globe = { maximumScreenSpaceError: 0 };
	return { rt: { viewer: { scene: { globe } } } as never, globe };
}

describe('screenSpaceErrorFor', () => {
	it('asks for finer tiles low down than at cruise', () => {
		const low = screenSpaceErrorFor(resolveAtmosphere(300).groundDetail);
		const high = screenSpaceErrorFor(resolveAtmosphere(11_600).groundDetail);
		expect(low).toBeLessThan(high); // lower error = finer tiles
	});

	it('is total — nonsense input still yields a usable error', () => {
		for (const bad of [Number.NaN, -1, 2, Number.POSITIVE_INFINITY]) {
			expect(Number.isFinite(screenSpaceErrorFor(bad))).toBe(true);
		}
	});
});

describe('LodSync', () => {
	it('does not retile the globe for sub-threshold drift', () => {
		// Every change to maximumScreenSpaceError retiles. Without a deadband a
		// slow climb would retile continuously for no visible gain, and the
		// three panes would not do it on the same frame.
		const { rt, globe } = fakeRuntime();
		const sync = new LodSync();

		sync.sync(rt, resolveAtmosphere(500));
		const first = globe.maximumScreenSpaceError;
		expect(first).toBeGreaterThan(0);

		sync.sync(rt, resolveAtmosphere(520));
		expect(globe.maximumScreenSpaceError).toBe(first);
	});

	it('does step once the altitude change is real', () => {
		const { rt, globe } = fakeRuntime();
		const sync = new LodSync();
		sync.sync(rt, resolveAtmosphere(300));
		const low = globe.maximumScreenSpaceError;
		sync.sync(rt, resolveAtmosphere(12_000));
		expect(globe.maximumScreenSpaceError).toBeGreaterThan(low);
	});

	it('reapplies after reset, so a remounted viewer is not left stale', () => {
		const { rt, globe } = fakeRuntime();
		const sync = new LodSync();
		sync.sync(rt, resolveAtmosphere(300));
		sync.reset();
		globe.maximumScreenSpaceError = 0;
		sync.sync(rt, resolveAtmosphere(300));
		expect(globe.maximumScreenSpaceError).toBeGreaterThan(0);
	});
});
