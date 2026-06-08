/**
 * Show runner — walks an authored timeline, applying cue patches at
 * their scheduled offsets.
 *
 * Architecture (Move 1):
 *   - Singleton — only one show runs at a time. Calling startShow while
 *     another is active stops the previous one cleanly.
 *   - Wall-clock pacing. We use `Date.now()` rather than accumulating
 *     `dt` so a paused tab or HMR pause doesn't shift cue alignment.
 *     This also makes fleet sync trivial (`startAtMs` is a shared
 *     future wall-clock instant; every Pi reaches the same cue at the
 *     same moment).
 *   - Cue patches go through `model.applyConfigPatch(path, value)` for
 *     namespace-allowlisted writes, with three top-level paths handled
 *     via dedicated setters: `location`, `weather`, `timeOfDay`. Those
 *     setters fire UserInteraction trackers that pause the autopilot,
 *     so the show always wins precedence even without Move 2's guard.
 *     Move 2's `model.activeShowId` is the durable signal — setters
 *     are belt-and-suspenders.
 *   - On the final cue's tick (or explicit stopShow), clears
 *     activeShowId so the director (which has been suspended via
 *     ctx.showActive in autopilot.svelte.ts) resumes from the show's
 *     final state.
 *
 * The runner intentionally avoids `$state` for its internal clock —
 * walking cues from a useTask/setInterval would couple to Svelte's
 * scheduler and miss cues on backpressure. Setinterval at 100ms gives
 * cue accuracy ±100ms, which is below human perception for scene
 * transitions and comparable to the existing 2.5s fleet TRANSITION_DELAY.
 */

import type { Show, Cue } from './load';
import type { LocationId, WeatherType } from '$lib/types';
import { isValidLocation, type LocationId as ContentLocationId } from '$content/locations';
import { isValidWeather } from '$lib/types';

/**
 * Subset of AeroWindow we need to drive a show. Narrow on purpose —
 * the runner stays test-friendly (no Svelte 5 runes in tests) by
 * not importing the full AeroWindow class.
 */
export interface ShowRunnerModel {
	activeShowId: string | null;
	setLocation(loc: LocationId): void;
	setWeather(w: WeatherType): void;
	setTime(t: number): void;
	applyConfigPatch?: (path: string, value: unknown) => boolean;
}

interface ActiveRun {
	show: Show;
	sortedCues: Cue[];
	startAtMs: number;
	nextCueIdx: number;
	intervalId: ReturnType<typeof setInterval>;
	model: ShowRunnerModel;
}

let _active: ActiveRun | null = null;

/**
 * Tick frequency for the cue scheduler. 100 ms gives ±100 ms cue
 * accuracy — well below human perception threshold for scene
 * transitions, and matches the granularity of authored cue timings
 * (curators write in seconds, not milliseconds).
 */
const TICK_INTERVAL_MS = 100;

/**
 * Start a show. Walks `show.cues` in atMs order, firing each batch as
 * the wall clock crosses startAtMs + atMs.
 *
 * @param model    The AeroWindow (or test stand-in) to drive.
 * @param show     The authored show. Must have an id; cues optional.
 * @param startAtMs Wall-clock millis when the show "started" — typically
 *                 Date.now() for immediate, or a future instant for
 *                 fleet-synced rolls. Cues with atMs older than the
 *                 current wall clock at start are skipped (no
 *                 backfill) so a late-arriving show doesn't race-fire
 *                 cues from its past.
 */
export function startShow(
	model: ShowRunnerModel,
	show: Show,
	startAtMs: number = Date.now(),
): void {
	// Stop any prior run BEFORE setting activeShowId — keeps the
	// suspension guard consistent if startShow is called twice quickly.
	if (_active) stopShow();

	model.activeShowId = show.id;

	const cues = (show.cues ?? []).slice().sort((a, b) => a.atMs - b.atMs);

	// If show has no cues, treat as a "stamp-the-opening" no-op: the
	// caller already applied the opening via applyShowOpening; we just
	// clear activeShowId on the next tick so the director resumes.
	if (cues.length === 0) {
		model.activeShowId = null;
		return;
	}

	// Skip cues whose offset is already in the past — startShow can be
	// invoked with a startAtMs that lags wall clock (e.g., fleet message
	// arrived 200 ms late). Backfilling all skipped patches at once
	// would race-fire state changes; better to drop and continue.
	let firstIdx = 0;
	const now = Date.now();
	while (firstIdx < cues.length && startAtMs + cues[firstIdx].atMs < now) firstIdx++;

	const run: ActiveRun = {
		show,
		sortedCues: cues,
		startAtMs,
		nextCueIdx: firstIdx,
		intervalId: setInterval(() => tickRunner(), TICK_INTERVAL_MS),
		model,
	};
	_active = run;

	// Fire any cues whose offset already passed within this same tick
	// (catches cues scheduled at atMs=0).
	tickRunner();
}

/**
 * Stop the active show. Clears the interval, frees the runner, and
 * resets activeShowId so the director resumes. Safe to call when no
 * show is running.
 */
export function stopShow(): void {
	if (!_active) return;
	clearInterval(_active.intervalId);
	_active.model.activeShowId = null;
	_active = null;
}

/** Read-only view of the active run — for tests and debug UI. */
export function getActiveShow(): { showId: string; nextCueIdx: number; totalCues: number } | null {
	if (!_active) return null;
	return {
		showId: _active.show.id,
		nextCueIdx: _active.nextCueIdx,
		totalCues: _active.sortedCues.length,
	};
}

function tickRunner(): void {
	const run = _active;
	if (!run) return;

	const now = Date.now();
	const cues = run.sortedCues;

	// Walk cues whose offset has passed. A single tick may fire several
	// cues if the page was paused or cues are densely scheduled — we
	// want them ALL applied before the next visual frame composes.
	while (run.nextCueIdx < cues.length) {
		const cue = cues[run.nextCueIdx];
		const dueAt = run.startAtMs + cue.atMs;
		if (now < dueAt) break;
		applyCue(run.model, cue);
		run.nextCueIdx++;
	}

	// Last cue fired → wrap up. Clears activeShowId so the director
	// resumes from the show's final state (Move 2 wiring).
	if (run.nextCueIdx >= cues.length) stopShow();
}

function applyCue(model: ShowRunnerModel, cue: Cue): void {
	for (const { path, value } of cue.patches) {
		// High-level setters for fields with side effects (interaction
		// trackers, weather config sync, etc). Falling through to
		// applyConfigPatch for everything else gives shows access to the
		// full namespace allowlist (atmosphere.*, camera.*, world.*, etc).
		if (path === 'location' && isValidLocation(value)) {
			model.setLocation(value as ContentLocationId);
		} else if (path === 'weather' && typeof value === 'string' && isValidWeather(value)) {
			model.setWeather(value);
		} else if (path === 'timeOfDay' && typeof value === 'number' && Number.isFinite(value)) {
			model.setTime(value);
		} else {
			model.applyConfigPatch?.(path, value);
		}
	}
}
