/**
 * Scenario playback pacing.
 *
 * Waypoint `duration` values are authored as SECONDS. The engine used to
 * multiply the raw `flightSpeed` knob (default 4.0) into the progress rate, so
 * every authored leg ran 4x fast: dubai-approach's 225 s circuit finished in
 * 56 s and bled 28,000 -> 6,000 ft in about 25 s — roughly 53,000 ft/min,
 * against ~2,000 ft/min for a real airliner. The waypoints were plausible;
 * the playback rate was eating them.
 *
 * These pin the physical outcome rather than a specific scenario, so they hold
 * whichever one the day-seed picks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FlightSimEngine, DEFAULT_FLIGHT_SPEED } from '$lib/flight/flight.svelte';
import { camera as cameraConfig, director as directorConfig } from '$lib/model/config-tree.svelte';
import type { SimulationContext } from '$lib/types';

/** Cities have the low-altitude approach scenarios, so they set the worst case. */
const CITY = 'dubai';

function makeCtx(): SimulationContext {
	return {
		time: 0, lat: 0, lon: 0, altitude: 28000, heading: 45, pitch: 60, bankAngle: 0,
		weather: 'clear', skyState: 'dusk', nightFactor: 0, dawnDuskFactor: 0,
		locationId: CITY,
		userAdjustingAltitude: false, userAdjustingTime: false, userAdjustingAtmosphere: false,
		cloudDensity: 0.5, cloudSpeed: 0.5, haze: 0.07, warpFactor: 0,
		turbulenceLevel: 'light',
		camera: cameraConfig,
		director: directorConfig,
		isLeader: true,
	} as unknown as SimulationContext;
}

/**
 * Sustained vertical rate over a run, ft/min, as the 99th percentile of
 * per-tick rates.
 *
 * NOT the max: a scenario loop wrap and the hand-back to orbit both step the
 * altitude discontinuously, and a single such frame reads as millions of
 * ft/min. Those are teleports between authored points, not descents — p99
 * ignores the handful of jump frames while still catching a genuinely steep
 * leg, which is what this is measuring.
 */
function sustainedVerticalRateFtPerMin(seconds: number): number {
	const engine = new FlightSimEngine();
	engine.setLocationWithSky(CITY, 'dusk');
	const ctx = makeCtx();
	const dt = 0.1;
	let prevAlt = engine.altitude;
	const rates: number[] = [];
	for (let t = 0; t < seconds; t += dt) {
		engine.tick(dt, ctx);
		ctx.time += dt;
		rates.push((Math.abs(engine.altitude - prevAlt) / dt) * 60);
		prevAlt = engine.altitude;
	}
	rates.sort((a, b) => a - b);
	return rates[Math.floor(rates.length * 0.99)];
}

describe('scenario playback pacing', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 5, 15));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not fly airliner descents at rocket rates', () => {
		const peak = sustainedVerticalRateFtPerMin(600);
		// Measured over this 600 s run (p99 of per-tick rates):
		//   raw 4.0 knob (pre-fix):  80,442 ft/min
		//   normalised (current):    20,715 ft/min
		// — the 3.9x drop is the speed factor being removed, as expected.
		//
		// 30,000 leaves headroom for scenario-pick variation while still
		// failing loudly if the raw knob ever comes back.
		expect(peak).toBeLessThan(30_000);
		// Guard against passing vacuously on a scenario that never changes
		// altitude: pre-fix p50 was 1 ft/min precisely because the circuit
		// finished so fast that the run sat in level orbit for most of it.
		expect(peak).toBeGreaterThan(1_000);
	});

	it('scales linearly with the speed knob, normalised so default = authored seconds', () => {
		// Two engines, one at default and one at double, sampled at instants
		// that should map to the same point on the authored path.
		const a = new FlightSimEngine();
		const b = new FlightSimEngine();
		a.setLocationWithSky(CITY, 'dusk');
		b.setLocationWithSky(CITY, 'dusk');
		b.flightSpeed = DEFAULT_FLIGHT_SPEED * 2;

		const ctxA = makeCtx();
		const ctxB = makeCtx();
		// b covers the same authored distance in half the wall time.
		for (let t = 0; t < 40; t += 0.1) { a.tick(0.1, ctxA); ctxA.time += 0.1; }
		for (let t = 0; t < 20; t += 0.1) { b.tick(0.1, ctxB); ctxB.time += 0.1; }

		// 3dp ≈ 100 m. Not tighter: the path carries a small sine jitter keyed
		// to ctx.time (amplitude ~0.0003 deg, ~33 m), and the two engines are
		// sampled at different ctx.time values by construction — so they follow
		// the same authored curve with slightly different jitter phase.
		expect(b.lat).toBeCloseTo(a.lat, 3);
		expect(b.lon).toBeCloseTo(a.lon, 3);
	});
});
