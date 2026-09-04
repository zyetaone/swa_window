import { describe, it, expect } from 'vitest';
import {
	decodeThrottleFlags,
	parseThrottledRaw,
	thermalAction,
	THERMAL_CLEAR_TEMP_C,
	THERMAL_SHED_TEMP_C
} from '#lib/throttle.js';

describe('parseThrottledRaw', () => {
	it('accepts every shape vcgencmd and health-check produce', () => {
		expect(parseThrottledRaw('throttled=0x50005')).toBe(0x50005);
		expect(parseThrottledRaw('0x5')).toBe(5);
		expect(parseThrottledRaw('5')).toBe(5);
		expect(parseThrottledRaw(5)).toBe(5);
	});

	it('falls back to 0 rather than NaN for junk', () => {
		for (const v of [undefined, null, '', 'nope', -1, 1.5e400, {}]) {
			expect(Number.isInteger(parseThrottledRaw(v)), String(v)).toBe(true);
		}
		expect(parseThrottledRaw('nope')).toBe(0);
		expect(parseThrottledRaw(-1)).toBe(0);
	});
});

describe('decodeThrottleFlags', () => {
	it('reads the four live bits', () => {
		const f = decodeThrottleFlags(0b1111);
		expect(f).toMatchObject({
			underVoltage: true,
			freqCapped: true,
			throttled: true,
			softTempLimit: true,
			livePressure: true
		});
	});

	/**
	 * The sticky bits (16-19) say something happened at some point since boot.
	 * Treating them as live pressure would pin a Pi in shed mode for its whole
	 * uptime after one overnight dip.
	 */
	it('does not treat sticky since-boot bits as live pressure', () => {
		const f = decodeThrottleFlags(0x50000);
		expect(f.livePressure).toBe(false);
		expect(f.raw).toBe(0x50000);
	});
});

describe('thermalAction', () => {
	it('sheds on live pressure at any temperature', () => {
		expect(thermalAction(20, { livePressure: true })).toBe('shed');
	});

	it('sheds at the threshold, not just past it', () => {
		expect(thermalAction(THERMAL_SHED_TEMP_C, { livePressure: false })).toBe('shed');
		expect(thermalAction(THERMAL_SHED_TEMP_C - 1, { livePressure: false })).toBe('ok');
	});

	/**
	 * The hysteresis band is the whole point: without `prev` the quality mode
	 * flaps every few seconds around the threshold, which is far more visible on
	 * the wall than the heat.
	 */
	it('stays shed through the band and clears only below it', () => {
		const between = (THERMAL_SHED_TEMP_C + THERMAL_CLEAR_TEMP_C) / 2;
		expect(thermalAction(between, { livePressure: false }, 'shed')).toBe('shed');
		expect(thermalAction(between, { livePressure: false }, 'ok')).toBe('ok');
		expect(thermalAction(THERMAL_CLEAR_TEMP_C, { livePressure: false }, 'shed')).toBe('ok');
	});

	it('treats a non-finite temperature as cold, not as hot', () => {
		expect(thermalAction(Number.NaN, { livePressure: false })).toBe('ok');
	});
});
