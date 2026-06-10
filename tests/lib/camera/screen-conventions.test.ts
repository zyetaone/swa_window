import { describe, it, expect, beforeEach } from 'vitest';
import {
	DEFAULT_SCREEN_DRIFT_SIGN,
	getScreenDriftSign,
	setScreenDriftSign,
	screenTravelSign,
} from '$lib/camera/screen-conventions';

describe('screen-conventions — single travel-sign parity', () => {
	beforeEach(() => setScreenDriftSign(DEFAULT_SCREEN_DRIFT_SIGN));

	it('starts at the baked default sign', () => {
		expect(getScreenDriftSign()).toBe(DEFAULT_SCREEN_DRIFT_SIGN);
	});

	it('screenTravelSign = travelSign × parity', () => {
		setScreenDriftSign(1);
		expect(screenTravelSign(1)).toBe(1);
		expect(screenTravelSign(-1)).toBe(-1);

		setScreenDriftSign(-1);
		expect(screenTravelSign(1)).toBe(-1);
		expect(screenTravelSign(-1)).toBe(1);
	});

	it('normalizes any nonzero travel value to ±1', () => {
		setScreenDriftSign(1);
		expect(screenTravelSign(5)).toBe(1);
		expect(screenTravelSign(-0.2)).toBe(-1);
	});

	it('flips together for opposite travel — mirror + lean stay consistent by construction', () => {
		// Wing mirror uses (screenSign >= 0 ? 1 : -1); turn-lean uses
		// (screenSign × ORBIT_BANK_DEG). Both read the SAME screenTravelSign, so
		// reversing travel reverses both in lock-step — they can never desync.
		setScreenDriftSign(1);
		expect(Math.sign(screenTravelSign(1))).toBe(-Math.sign(screenTravelSign(-1)));
	});

	it('setScreenDriftSign clamps to ±1', () => {
		setScreenDriftSign(0);
		expect(getScreenDriftSign()).toBe(1);
		setScreenDriftSign(-3);
		expect(getScreenDriftSign()).toBe(-1);
		setScreenDriftSign(42);
		expect(getScreenDriftSign()).toBe(1);
	});
});
