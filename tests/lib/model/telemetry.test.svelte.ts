import { describe, it, expect } from 'vitest';
import { Telemetry } from '$lib/model/telemetry.svelte';

describe('Telemetry.recordFrame', () => {
	it('starts empty with zero percentiles', () => {
		const t = new Telemetry();
		expect(t.tickMsP50).toBe(0);
		expect(t.tickMsP95).toBe(0);
		expect(t.tickMsRecent).toEqual([]);
	});

	it('caps tickMsRecent at 120 samples', () => {
		const t = new Telemetry();
		for (let i = 0; i < 200; i++) t.recordFrame(i % 50);
		t.flush();
		expect(t.tickMsRecent.length).toBe(120);
	});

	it('computes percentiles over the rolling window', () => {
		const t = new Telemetry();
		for (let i = 1; i <= 100; i++) t.recordFrame(i);
		t.flush();
		// 100 samples 1..100 — p50 ≈ 50, p95 ≈ 95
		expect(t.tickMsP50).toBeGreaterThanOrEqual(49);
		expect(t.tickMsP50).toBeLessThanOrEqual(51);
		expect(t.tickMsP95).toBeGreaterThanOrEqual(94);
		expect(t.tickMsP95).toBeLessThanOrEqual(96);
	});

	it('ignores non-finite / negative durations', () => {
		const t = new Telemetry();
		t.recordFrame(NaN);
		t.recordFrame(-1);
		t.recordFrame(Infinity);
		t.flush();
		expect(t.tickMsRecent.length).toBe(0);
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
		t.recordFramePeriod(16);
		t.recordEvent('fleet_in', {});
		t.clear();
		t.flush();
		expect(t.tickMsRecent).toEqual([]);
		expect(t.periodMsRecent).toEqual([]);
		expect(t.events).toEqual([]);
		expect(t.counts.fleetIn).toBe(0);
	});

	it('toJSON returns a plain snapshot including pending frames', () => {
		const t = new Telemetry();
		// Below flush threshold — toJSON should still include these.
		t.recordFrame(2);
		t.recordFrame(4);
		const snap = t.toJSON();
		expect(snap.tick.recent.length).toBe(2);
		expect(snap.tick.p50).toBeGreaterThan(0);
		expect(snap.counts).toEqual({ configPatches: 0, fleetIn: 0, fleetOut: 0, errors: 0 });
	});
});

describe('Telemetry.fps (frame period, not a per-second count)', () => {
	it('is zero until a period is recorded', () => {
		const t = new Telemetry();
		expect(t.fps).toBe(0);
		expect(t.fpsLow).toBe(0);
	});

	it('goes live on the very first period sample', () => {
		// Guards the boot lockup + liveness watchdog, which both gate on
		// fps > 0. Waiting for a full flush batch would blind them for
		// ~10 s at the 3 fps the Pi panel actually runs at.
		const t = new Telemetry();
		t.recordFramePeriod(333);
		expect(t.fps).toBeGreaterThan(0);
	});

	it('keeps fractional resolution at the low frame rates the Pi runs at', () => {
		// The regression: a per-wall-second frame counter rounds ~3 frames
		// per window to an integer, so 3.0 and 3.4 fps are indistinguishable
		// and a real regression reads as no change.
		const slow = new Telemetry();
		for (let i = 0; i < 40; i++) slow.recordFramePeriod(333);
		slow.flush();
		const slower = new Telemetry();
		for (let i = 0; i < 40; i++) slower.recordFramePeriod(400);
		slower.flush();

		expect(slow.fps).toBeCloseTo(3.0, 1);
		expect(slower.fps).toBeCloseTo(2.5, 1);
		expect(slow.fps).not.toBe(slower.fps);
	});

	it('does not count the boundary frame twice (N frames span N-1 intervals)', () => {
		// 2 fps = 500 ms periods. The old counter saw 3 frames inside a
		// 1000 ms window and reported 3 fps — a 50 % over-report.
		const t = new Telemetry();
		for (let i = 0; i < 20; i++) t.recordFramePeriod(500);
		t.flush();
		expect(t.fps).toBeCloseTo(2.0, 1);
	});

	it('reports fpsLow from the worst frames, not the median', () => {
		const t = new Telemetry();
		for (let i = 0; i < 18; i++) t.recordFramePeriod(16);
		t.recordFramePeriod(500); // long stalls, ~10% of frames
		t.recordFramePeriod(500);
		t.flush();
		expect(t.fps).toBeGreaterThan(50);      // median unaffected
		expect(t.fpsLow).toBeLessThan(t.fps);   // p95 catches the stall
	});

	it('ignores non-positive / non-finite periods', () => {
		const t = new Telemetry();
		t.recordFramePeriod(0);
		t.recordFramePeriod(-5);
		t.recordFramePeriod(NaN);
		t.flush();
		expect(t.periodMsRecent.length).toBe(0);
		expect(t.fps).toBe(0);
	});
});
