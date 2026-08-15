/**
 * SceneTimers — the flyover beat and the lock-step cruise.
 *
 * These were previously two timer collections buried in an 800-line class, so
 * the question that actually matters — "does every path cancel everything?" —
 * could only be answered by reading the whole file. Split out, it is one
 * object with one destroy(), and the cancellation semantics become directly
 * assertable with fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SceneTimers, type SceneTimerHost } from '$lib/model/aero-window-timers';

function makeHost() {
	const calls: Array<[string, unknown]> = [];
	const host: SceneTimerHost & {
		calls: typeof calls;
		flewTo: string[];
		stamped: string[];
		flyoverAlt: number | null;
	} = {
		skyState: 'night' as SceneTimerHost['skyState'],
		config: { camera: { altitude: { min: 10_000 } } },
		flight: {
			setFlyoverAltitude(ft: number) { host.flyoverAlt = ft; },
			clearFlyoverAltitude() { host.flyoverAlt = null; },
			flyTo(id: string) { host.flewTo.push(id); },
		} as unknown as SceneTimerHost['flight'],
		applyConfigPatch(path: string, value: unknown) { calls.push([path, value]); return true; },
		stampRoute(toId: string) { host.stamped.push(toId); },
		calls,
		flewTo: [],
		stamped: [],
		flyoverAlt: null,
	};
	return host;
}

let host: ReturnType<typeof makeHost>;
let timers: SceneTimers;

beforeEach(() => {
	vi.useFakeTimers();
	host = makeHost();
	timers = new SceneTimers(() => host);
});
afterEach(() => {
	timers.destroy();
	vi.useRealTimers();
});

const beat = { durationMs: 5_000, pitchDeg: -60, altitudeFt: 4_000 };

describe('flyover beat', () => {
	it('locks both edges to the shared instant', () => {
		timers.scheduleFlyover(beat, Date.now() + 2_500);
		expect(host.calls.find(([p]) => p === 'camera.flyoverPitchDeg')?.[1]).toBe(0); // exit-first
		vi.advanceTimersByTime(2_500);
		expect(host.calls.at(-1)).toEqual(['camera.flyoverPitchDeg', -60]);
		vi.advanceTimersByTime(5_000);
		expect(host.calls.at(-1)).toEqual(['camera.flyoverPitchDeg', 0]);
	});

	it('floors the flyover altitude at the configured minimum', () => {
		// A beat authored below the cruise floor must not drive the camera
		// underground — the clamp is why the host exposes altitude.min at all.
		timers.scheduleFlyover({ ...beat, altitudeFt: 500 }, Date.now());
		vi.advanceTimersByTime(1);
		expect(host.flyoverAlt).toBe(10_000);
	});

	it('supersedes a beat already pending instead of stacking', () => {
		timers.scheduleFlyover(beat, Date.now() + 1_000);
		timers.scheduleFlyover(beat, Date.now() + 1_000);
		expect(timers.pendingFlyoverCount).toBe(1);
	});

	it('cancels a pending beat on exitFlyover', () => {
		timers.scheduleFlyover(beat, Date.now() + 1_000);
		timers.exitFlyover();
		expect(timers.pendingFlyoverCount).toBe(0);
		vi.advanceTimersByTime(10_000);
		// The enter edge must never fire after being cancelled.
		expect(host.calls.some(([, v]) => v === -60)).toBe(false);
	});
});

describe('lock-step cruise', () => {
	it('stamps the route at SCHEDULE time, not on arrival', () => {
		// A closed blind must read From → To during the ~2.5 s lock-step wait,
		// not stay blank until the cruise engines start.
		timers.scheduleFlyTo('dubai', Date.now() + 2_500);
		expect(host.stamped).toEqual(['dubai']);
		expect(host.flewTo).toEqual([]);
		vi.advanceTimersByTime(2_500);
		expect(host.flewTo).toEqual(['dubai']);
	});

	it('keeps a single slot — a newer cruise supersedes a pending one', () => {
		timers.scheduleFlyTo('dubai', Date.now() + 2_500);
		timers.scheduleFlyTo('denver', Date.now() + 2_500);
		vi.advanceTimersByTime(5_000);
		expect(host.flewTo).toEqual(['denver']);
	});

	it('cancels cleanly', () => {
		timers.scheduleFlyTo('dubai', Date.now() + 2_500);
		timers.cancelScheduledFlyTo();
		expect(timers.hasPendingFlyTo).toBe(false);
		vi.advanceTimersByTime(5_000);
		expect(host.flewTo).toEqual([]);
	});
});

describe('destroy', () => {
	it('cancels BOTH collections — the reason this object exists', () => {
		timers.scheduleFlyover(beat, Date.now() + 1_000);
		timers.scheduleFlyTo('dubai', Date.now() + 1_000);
		timers.destroy();
		vi.advanceTimersByTime(60_000);
		expect(host.flewTo).toEqual([]);
		expect(timers.pendingFlyoverCount).toBe(0);
		expect(timers.hasPendingFlyTo).toBe(false);
	});

	it('does not write config on the way out', () => {
		// destroy() runs when the model is being torn down; patching config
		// there writes into something that is going away. exitFlyover() is the
		// path that writes — destroy() must not call it.
		timers.scheduleFlyover(beat, Date.now() + 1_000);
		host.calls.length = 0;
		timers.destroy();
		expect(host.calls).toEqual([]);
	});
});
