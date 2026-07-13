/**
 * AeroWindow night-city flyover scheduling.
 *
 * scheduleFlyover is what makes the beat 3-Pi-safe: the leader and every
 * follower call it with the SAME transitionAtMs, so all Pis enter (pitch down)
 * and exit (pop back) at the same wall-clock instant. These pin: enter/exit
 * edges land on the schedule, a superseding beat cancels the prior one, a
 * location change cancels an active beat, and the altitude override is clamped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';

const BEAT = { durationMs: 45_000, pitchDeg: -60, altitudeFt: 9000 };

let m: AeroWindow;

beforeEach(() => {
	vi.useFakeTimers();
	m = new AeroWindow();
	m.config.camera.flyoverPitchDeg = 0;   // shared module config — start clean
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('AeroWindow flyover beat', () => {
	it('enterFlyover pitches down; exitFlyover pops back', () => {
		m.enterFlyover(-60, 9000);
		expect(m.config.camera.flyoverPitchDeg).toBe(-60);
		m.exitFlyover();
		expect(m.config.camera.flyoverPitchDeg).toBe(0);
	});

	it('scheduleFlyover enters at transitionAtMs and exits durationMs later', () => {
		m.scheduleFlyover(BEAT, Date.now() + 2500);
		expect(m.config.camera.flyoverPitchDeg).toBe(0);   // nothing before the instant
		vi.advanceTimersByTime(2500);
		expect(m.config.camera.flyoverPitchDeg).toBe(-60);  // entered
		vi.advanceTimersByTime(45_000);
		expect(m.config.camera.flyoverPitchDeg).toBe(0);    // auto-exited
	});

	it('a location change cancels an active beat and its pending exit', () => {
		m.scheduleFlyover(BEAT, Date.now() + 2500);
		vi.advanceTimersByTime(2500);
		expect(m.config.camera.flyoverPitchDeg).toBe(-60);
		m.applyScene('dubai');                              // world moves → cancel
		expect(m.config.camera.flyoverPitchDeg).toBe(0);
		vi.advanceTimersByTime(45_000);                     // stale exit must not re-toggle
		expect(m.config.camera.flyoverPitchDeg).toBe(0);
	});

	it('a new beat supersedes a still-pending one', () => {
		m.scheduleFlyover(BEAT, Date.now() + 1000);
		m.scheduleFlyover(BEAT, Date.now() + 5000);         // replaces the first
		vi.advanceTimersByTime(1000);
		expect(m.config.camera.flyoverPitchDeg).toBe(0);    // first was cancelled
		vi.advanceTimersByTime(4000);
		expect(m.config.camera.flyoverPitchDeg).toBe(-60);  // second entered
	});

	it('destroy cancels a pending beat', () => {
		m.scheduleFlyover(BEAT, Date.now() + 2500);
		m.destroy();
		vi.advanceTimersByTime(60_000);
		expect(m.config.camera.flyoverPitchDeg).toBe(0);
	});
});
