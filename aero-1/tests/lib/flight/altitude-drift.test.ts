/**
 * Altitude drift — the slow climb/descent that keeps the ground changing scale
 * between hops.
 *
 * The property that matters most here is not the shape of the curve, it is that
 * the curve is a pure function of WALL-CLOCK TIME. That is what makes it safe on
 * a 3-pane wall without a broadcast: every Pi evaluates the same instant and
 * gets the same number.
 */
import { describe, it, expect } from 'vitest';
import { altitudeDriftFt } from '$lib/flight/flight.svelte';

const AMP = 3500;
const PERIOD = 420;

describe('altitudeDriftFt', () => {
	it('is identical for the same instant, which is what keeps the panorama together', () => {
		// Three panes, no shared state, no message passing — same t, same answer.
		const t = 1_760_000_000_000;
		expect(altitudeDriftFt(AMP, PERIOD, t)).toBe(altitudeDriftFt(AMP, PERIOD, t));
		expect(altitudeDriftFt(AMP, PERIOD, t)).toBe(altitudeDriftFt(AMP, PERIOD, t));
	});

	it('does not restart from zero when a pane reboots mid-cycle', () => {
		// A local accumulating timer would reset to 0 on boot and drift from the
		// other two for a full cycle. Phase comes from the clock, so a "rebooted"
		// caller landing at the same instant lands at the same offset.
		const t = 1_760_000_123_456;
		const beforeReboot = altitudeDriftFt(AMP, PERIOD, t);
		const afterReboot = altitudeDriftFt(AMP, PERIOD, t);
		expect(afterReboot).toBe(beforeReboot);
	});

	it('stays within the requested amplitude', () => {
		for (let i = 0; i < 500; i++) {
			const v = altitudeDriftFt(AMP, PERIOD, i * 3_137);
			expect(Math.abs(v)).toBeLessThanOrEqual(AMP + 1e-9);
		}
	});

	it('actually moves across a cycle', () => {
		// Guards against a silent zero — a constant offset would pass the bound
		// check above while delivering none of the dynamism it exists for.
		const samples = Array.from({ length: 60 }, (_, i) =>
			altitudeDriftFt(AMP, PERIOD, i * (PERIOD * 1000 / 60)),
		);
		expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(AMP);
	});

	it('returns 0 rather than NaN for absent or nonsense config', () => {
		// `undefined <= 0` is false, so a bare sign test let undefined through and
		// turned every downstream altitude into NaN — which freezes the camera
		// silently instead of throwing. An older persisted config does exactly
		// this. Regression guard.
		const bad = [undefined, null, NaN, Infinity] as unknown as number[];
		for (const v of bad) {
			expect(altitudeDriftFt(v, PERIOD, 0)).toBe(0);
			expect(altitudeDriftFt(AMP, v, 0)).toBe(0);
		}
		expect(altitudeDriftFt(0, PERIOD, 0)).toBe(0);
		expect(altitudeDriftFt(-100, PERIOD, 0)).toBe(0);
	});
});
