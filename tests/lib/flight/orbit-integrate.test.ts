import { describe, it, expect } from 'vitest';
import { integrateOrbitAngle } from '$lib/flight/flight.svelte';

describe('integrateOrbitAngle (absolute derivation)', () => {
	const base = {
		angle0: 0.5,
		a: 0.15,
		b: 0.06,
		direction: 1,
		driftRate: 0.01,
		flightSpeed: 4,
		stepSec: 0.05,
	};

	it('is deterministic for the same wall window', () => {
		const a = integrateOrbitAngle({ ...base, wallT0: 1000, wallT: 1005 });
		const b = integrateOrbitAngle({ ...base, wallT0: 1000, wallT: 1005 });
		expect(a).toBe(b);
	});

	it('self-heals: one big step matches many small steps to the same wallT', () => {
		// Incremental simulation of a slow Pi (0.3 s frames) vs a fast one
		// (0.05 s) — both end at the same wallT from the same epoch.
		const wallT0 = 2000;
		const wallT = 2003;
		const direct = integrateOrbitAngle({ ...base, wallT0, wallT });

		let angle = base.angle0;
		let t = wallT0;
		while (t < wallT) {
			const next = Math.min(t + 0.3, wallT);
			angle = integrateOrbitAngle({
				...base,
				angle0: angle,
				wallT0: t,
				wallT: next,
			});
			t = next;
		}
		expect(angle).toBeCloseTo(direct, 5);
	});

	it('is a no-op when wallT does not advance', () => {
		expect(integrateOrbitAngle({ ...base, wallT0: 10, wallT: 10 })).toBeCloseTo(
			base.angle0,
			10,
		);
	});
});
