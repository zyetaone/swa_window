import { describe, it, expect } from 'vitest';
import { Telemetry } from '$lib/model/telemetry.svelte';

describe('Telemetry.recordFrame', () => {
	it('starts empty with zero percentiles', () => {
		const t = new Telemetry();
		expect(t.p50).toBe(0);
		expect(t.p95).toBe(0);
		expect(t.fpsRecent).toEqual([]);
	});

	it('caps fpsRecent at 120 samples', () => {
		const t = new Telemetry();
		for (let i = 0; i < 200; i++) t.recordFrame(i % 50);
		t.flush();
		expect(t.fpsRecent.length).toBe(120);
	});

	it('computes percentiles over the rolling window', () => {
		const t = new Telemetry();
		for (let i = 1; i <= 100; i++) t.recordFrame(i);
		t.flush();
		// 100 samples 1..100 — p50 ≈ 50, p95 ≈ 95
		expect(t.p50).toBeGreaterThanOrEqual(49);
		expect(t.p50).toBeLessThanOrEqual(51);
		expect(t.p95).toBeGreaterThanOrEqual(94);
		expect(t.p95).toBeLessThanOrEqual(96);
	});

	it('ignores non-finite / negative durations', () => {
		const t = new Telemetry();
		t.recordFrame(NaN);
		t.recordFrame(-1);
		t.recordFrame(Infinity);
		t.flush();
		expect(t.fpsRecent.length).toBe(0);
	});

	it('adds negligible overhead per recordFrame call', () => {
		const t = new Telemetry();
		const iterations = 100_000;
		const start = performance.now();
		for (let i = 0; i < iterations; i++) t.recordFrame(1.5);
		const elapsed = performance.now() - start;
		const perCall = elapsed / iterations;
		// Budget: < 0.2 ms per frame instrumentation.
		// 100k calls should finish in <<  200ms even on a slow CI runner.
		expect(perCall).toBeLessThan(0.2);
	});
});

describe('Telemetry.recordEvent', () => {
	it('appends events and bumps the matching counter', () => {
		const t = new Telemetry();
		t.recordEvent('fleet_in', { type: 'ping' });
		t.recordEvent('fleet_out', { type: 'pong' });
		t.recordEvent('config_patch', { path: 'x', value: 1 });
		t.recordEvent('error', new Error('boom'));
		expect(t.events.length).toBe(4);
		expect(t.counts.fleetIn).toBe(1);
		expect(t.counts.fleetOut).toBe(1);
		expect(t.counts.configPatches).toBe(1);
		expect(t.counts.errors).toBe(1);
	});

	it('caps the event ring at 500 entries', () => {
		const t = new Telemetry();
		for (let i = 0; i < 600; i++) t.recordEvent('info', { i });
		expect(t.events.length).toBe(500);
		// Oldest 100 dropped — first remaining should be { i: 100 }.
		expect((t.events[0].payload as { i: number }).i).toBe(100);
	});
});

describe('Telemetry.clear + toJSON', () => {
	it('clear resets everything', () => {
		const t = new Telemetry();
		t.recordFrame(5);
		t.recordEvent('fleet_in', {});
		t.clear();
		t.flush();
		expect(t.fpsRecent).toEqual([]);
		expect(t.events).toEqual([]);
		expect(t.counts.fleetIn).toBe(0);
	});

	it('toJSON returns a plain snapshot including pending frames', () => {
		const t = new Telemetry();
		// Below flush threshold — toJSON should still include these.
		t.recordFrame(2);
		t.recordFrame(4);
		const snap = t.toJSON();
		expect(snap.fps.recent.length).toBe(2);
		expect(snap.fps.p50).toBeGreaterThan(0);
		expect(snap.counts).toEqual({ configPatches: 0, fleetIn: 0, fleetOut: 0, errors: 0 });
	});
});
