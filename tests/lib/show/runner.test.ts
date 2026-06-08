/**
 * Show runner coverage (Move 1).
 *
 * The runner is a singleton — these tests reset state via stopShow() in
 * afterEach to keep them isolated. The fake clock from vitest gives us
 * precise control over wall-clock-driven cue firing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startShow, stopShow, getActiveShow, type ShowRunnerModel } from '$lib/show/runner.svelte';
import type { Show } from '$lib/show/load';

function makeModel(): ShowRunnerModel & {
	location: string;
	weather: string;
	timeOfDay: number;
	patches: Array<{ path: string; value: unknown }>;
} {
	const model = {
		activeShowId: null as string | null,
		location: 'hyderabad' as string,
		weather: 'cloudy' as string,
		timeOfDay: 12,
		patches: [] as Array<{ path: string; value: unknown }>,
		setLocation(loc: string) { this.location = loc; },
		setWeather(w: string) { this.weather = w; },
		setTime(t: number) { this.timeOfDay = t; },
		applyConfigPatch(path: string, value: unknown) {
			this.patches.push({ path, value });
			return true;
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
	return model;
}

const SHOW_WITH_CUES: Show = {
	id: 'test-show',
	name: 'Test Show',
	opening: { location: 'hyderabad', weather: 'clear', timeOfDay: 6 },
	cues: [
		{ atMs: 0, patches: [{ path: 'weather', value: 'cloudy' }] },
		{ atMs: 2000, patches: [{ path: 'location', value: 'dubai' }] },
		{ atMs: 5000, patches: [
			{ path: 'timeOfDay', value: 18.5 },
			{ path: 'atmosphere.clouds.density', value: 0.9 },
		] },
	],
};

describe('Show runner — startShow + stopShow + cue scheduling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		stopShow();
		vi.useRealTimers();
	});

	it('sets activeShowId on start, clears it on stop', () => {
		const model = makeModel();
		startShow(model, SHOW_WITH_CUES);
		expect(model.activeShowId).toBe('test-show');
		stopShow();
		expect(model.activeShowId).toBeNull();
	});

	it('returns null active show after stopShow', () => {
		const model = makeModel();
		startShow(model, SHOW_WITH_CUES);
		expect(getActiveShow()).not.toBeNull();
		stopShow();
		expect(getActiveShow()).toBeNull();
	});

	it('fires the atMs=0 cue immediately on start', () => {
		const model = makeModel();
		startShow(model, SHOW_WITH_CUES);
		// First cue is `weather: cloudy` at atMs=0
		expect(model.weather).toBe('cloudy');
	});

	it('fires subsequent cues at their atMs offsets', () => {
		const model = makeModel();
		const startAt = Date.now();
		startShow(model, SHOW_WITH_CUES, startAt);

		// At t=0 only the first cue has fired.
		expect(model.location).toBe('hyderabad');

		// Advance to t=2100ms — second cue (location:dubai) should fire.
		vi.advanceTimersByTime(2100);
		expect(model.location).toBe('dubai');

		// Advance to t=5100ms — third cue (timeOfDay + cloud density) fires.
		vi.advanceTimersByTime(3000);
		expect(model.timeOfDay).toBe(18.5);
		expect(model.patches).toContainEqual({ path: 'atmosphere.clouds.density', value: 0.9 });
	});

	it('clears activeShowId after the final cue fires', () => {
		const model = makeModel();
		startShow(model, SHOW_WITH_CUES);
		// All three cues span 0..5000 ms.
		vi.advanceTimersByTime(5200);
		// Director should now resume.
		expect(model.activeShowId).toBeNull();
		expect(getActiveShow()).toBeNull();
	});

	it('skips cues whose offset is in the past at startShow', () => {
		const model = makeModel();
		// Pretend the show was supposed to start 3000ms ago — first two
		// cues (atMs=0, atMs=2000) should be SKIPPED, not back-fired.
		startShow(model, SHOW_WITH_CUES, Date.now() - 3000);
		// Skipped: weather=cloudy and location=dubai didn't run.
		expect(model.weather).toBe('cloudy'); // model default, unchanged by skip
		expect(model.location).toBe('hyderabad'); // skipped
		// The remaining cue (atMs=5000) is still in the future relative to
		// the (past) start, so it hasn't fired yet either.
		expect(model.timeOfDay).toBe(12);
		// Advance to where the surviving cue is due.
		vi.advanceTimersByTime(2100);
		expect(model.timeOfDay).toBe(18.5);
	});

	it('starting a new show stops the previous run cleanly', () => {
		const model = makeModel();
		startShow(model, SHOW_WITH_CUES);
		expect(model.activeShowId).toBe('test-show');

		// Use a show with a future cue so the new show stays active after
		// startShow returns (a 1-cue at atMs=0 completes immediately,
		// which would clear activeShowId — different test case).
		const otherShow: Show = {
			id: 'other-show',
			name: 'Other',
			opening: { location: 'dubai', weather: 'storm', timeOfDay: 22 },
			cues: [
				{ atMs: 0, patches: [{ path: 'weather', value: 'storm' }] },
				{ atMs: 10_000, patches: [{ path: 'location', value: 'london' }] },
			],
		};
		startShow(model, otherShow);
		expect(model.activeShowId).toBe('other-show');
		expect(model.weather).toBe('storm');
		expect(getActiveShow()?.totalCues).toBe(2);
	});

	it('show with no cues clears activeShowId immediately', () => {
		const model = makeModel();
		const bootOnly: Show = {
			id: 'boot-only',
			name: 'Boot baseline only',
			opening: { location: 'hyderabad', weather: 'clear', timeOfDay: 12 },
		};
		startShow(model, bootOnly);
		// No cues → nothing to schedule → activeShowId clears.
		expect(model.activeShowId).toBeNull();
	});

	it('empty-patches cue acts as a hold marker that delays release', () => {
		const model = makeModel();
		const showWithHold: Show = {
			id: 'with-hold',
			name: 'Hold demo',
			opening: { location: 'hyderabad', weather: 'clear', timeOfDay: 12 },
			cues: [
				{ atMs: 0, patches: [{ path: 'weather', value: 'rain' }] },
				{ atMs: 5000, patches: [], label: 'hold' },
			],
		};
		const startAt = Date.now();
		startShow(model, showWithHold, startAt);
		expect(model.weather).toBe('rain');
		// Show still active during the hold window.
		vi.advanceTimersByTime(2000);
		expect(model.activeShowId).toBe('with-hold');
		// Hold cue at 5000 ms fires → empty patches → runner releases.
		vi.advanceTimersByTime(3500);
		expect(model.activeShowId).toBeNull();
	});

	it('invalid path values fall through to applyConfigPatch', () => {
		const model = makeModel();
		const showWithGenericPatch: Show = {
			id: 'gp',
			name: 'Generic patch',
			opening: { location: 'hyderabad', weather: 'clear', timeOfDay: 12 },
			cues: [{
				atMs: 0,
				patches: [
					// Arbitrary namespace-allowlisted path — goes through
					// applyConfigPatch, not a top-level setter.
					{ path: 'world.nightLightIntensity', value: 2.5 },
				],
			}],
		};
		startShow(model, showWithGenericPatch);
		expect(model.patches).toContainEqual({ path: 'world.nightLightIntensity', value: 2.5 });
	});
});
