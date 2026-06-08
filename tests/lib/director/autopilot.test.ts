/**
 * Coverage for the Move 2 show-precedence guard on the director.
 *
 * The director auto-cycles weather + location at intervals. When an
 * authored show is running, it must SUSPEND so the show owns scene
 * state without contention. The guard is one line in directorTick;
 * this test pins the contract so a future refactor that reorders the
 * early-returns surfaces as a CI signal.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { directorTick } from '$lib/director/autopilot.svelte';
import type { SimulationContext } from '$lib/types';

function makeCtx(overrides: Partial<SimulationContext> = {}): SimulationContext {
	return {
		time: 0, lat: 17, lon: 78, altitude: 35000, heading: 0, pitch: 0,
		bankAngle: 0, weather: 'cloudy', skyState: 'day',
		nightFactor: 0, dawnDuskFactor: 0, locationId: 'hyderabad',
		userAdjustingAltitude: false, userAdjustingTime: false, userAdjustingAtmosphere: false,
		cloudDensity: 0.5, cloudSpeed: 0.4, haze: 0.1, warpFactor: 0,
		turbulenceLevel: 'light',
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		camera: {} as any,
		director: {
			autopilot: {
				enabled: true,
				initialMinDelay: 1, initialMaxDelay: 1,
				subsequentMinDelay: 1, subsequentMaxDelay: 1,
				weatherChangeChance: 1,
				weatherPool: ['clear'],
				directorMinInterval: 1, directorMaxInterval: 1,
				nightLitCitiesOnly: false,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any,
			ambient: {
				cloudDensityShift: 0.1, cloudDensityMin: 0, cloudDensityMax: 1,
				cloudSpeedShift: 0.1, cloudSpeedMin: 0, cloudSpeedMax: 1,
				hazeShift: 0.05, hazeMin: 0, hazeMax: 1,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any,
			daylight: { syncToRealTime: false, manualTimeOfDay: 12, syncIntervalMs: 1000 },
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any,
		isOrbitMode: true,
		isLeader: true,
		pickNextLocation: () => 'dubai',
		...overrides,
	};
}

describe('directorTick — show-precedence guard (Move 2)', () => {
	beforeEach(() => {
		// Tick once with no time elapsed to seed lazy timers without
		// firing anything — gets each test to a known clean baseline.
		directorTick(0, makeCtx({ showActive: true }));
	});

	it('returns empty patch when showActive is true even past randomize interval', () => {
		// First tick seeds timers. Second tick with large delta + showActive
		// would normally fire weather randomisation but must NOT.
		directorTick(0.1, makeCtx({ showActive: true }));
		const patch = directorTick(100, makeCtx({ showActive: true }));
		expect(patch.configs).toBeUndefined();
		expect(patch.nextLocation).toBeUndefined();
	});

	it('returns empty patch when not leader regardless of showActive', () => {
		const patch = directorTick(100, makeCtx({ isLeader: false, showActive: false }));
		expect(patch.configs).toBeUndefined();
		expect(patch.nextLocation).toBeUndefined();
	});

	it('runs randomisation normally when showActive is false', () => {
		// Two ticks: first seeds, second fires after the (1s) interval.
		directorTick(0, makeCtx({ showActive: false }));
		const patch = directorTick(5, makeCtx({ showActive: false }));
		// With showActive=false + large dt past the interval, randomisation
		// MUST fire. Verifying that the guard doesn't over-block by default.
		expect(patch.configs).toBeDefined();
		expect(patch.configs!.length).toBeGreaterThan(0);
	});
});
