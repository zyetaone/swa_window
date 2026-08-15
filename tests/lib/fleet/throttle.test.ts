import { describe, it, expect } from 'vitest';
import {
	decodeThrottleFlags,
	parseThrottledRaw,
	thermalAction,
	THERMAL_SHED_TEMP_C,
	THERMAL_CLEAR_TEMP_C,
	THROTTLE_BIT_THROTTLED,
	THROTTLE_BIT_UNDER_VOLTAGE,
	THROTTLE_BIT_THROTTLED_OCCURRED,
} from '$lib/fleet/throttle';

describe('parseThrottledRaw', () => {
	it('parses hex with or without 0x / throttled= prefix', () => {
		expect(parseThrottledRaw('0x50000')).toBe(0x50000);
		expect(parseThrottledRaw('throttled=0x5')).toBe(5);
		expect(parseThrottledRaw(7)).toBe(7);
	});

	it('returns 0 on garbage', () => {
		expect(parseThrottledRaw(undefined)).toBe(0);
		expect(parseThrottledRaw('nope')).toBe(0);
	});
});

describe('decodeThrottleFlags', () => {
	it('decodes live throttle bit', () => {
		const f = decodeThrottleFlags(THROTTLE_BIT_THROTTLED);
		expect(f.throttled).toBe(true);
		expect(f.livePressure).toBe(true);
		expect(f.throttledOccurred).toBe(false);
	});

	it('decodes sticky-only history without live pressure', () => {
		const f = decodeThrottleFlags(THROTTLE_BIT_THROTTLED_OCCURRED);
		expect(f.throttled).toBe(false);
		expect(f.throttledOccurred).toBe(true);
		expect(f.livePressure).toBe(false);
	});

	it('flags under-voltage as live pressure', () => {
		expect(decodeThrottleFlags(THROTTLE_BIT_UNDER_VOLTAGE).underVoltage).toBe(true);
		expect(decodeThrottleFlags(THROTTLE_BIT_UNDER_VOLTAGE).livePressure).toBe(true);
	});
});

describe('thermalAction', () => {
	const cool = { livePressure: false };

	it('sheds at or above SHED temp', () => {
		expect(thermalAction(THERMAL_SHED_TEMP_C, cool)).toBe('shed');
		expect(thermalAction(THERMAL_SHED_TEMP_C + 5, cool)).toBe('shed');
	});

	it('stays ok below SHED when no pressure', () => {
		expect(thermalAction(THERMAL_CLEAR_TEMP_C, cool)).toBe('ok');
		expect(thermalAction(60, cool)).toBe('ok');
	});

	it('hysteresis: stays shed until CLEAR when previously shedding', () => {
		expect(thermalAction(THERMAL_CLEAR_TEMP_C + 1, cool, 'shed')).toBe('shed');
		expect(thermalAction(THERMAL_CLEAR_TEMP_C, cool, 'shed')).toBe('ok');
	});

	it('sheds immediately on live pressure even when cool', () => {
		expect(thermalAction(40, { livePressure: true })).toBe('shed');
	});
});
