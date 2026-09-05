/**
 * Boot gates.
 *
 * Every boot bug in AeroWindow's history was a gate rather than a step, and
 * every one presented as "the wall is showing the wrong thing" instead of as
 * an error — the most expensive failure mode on an unattended fleet. These
 * assert the gates directly, without constructing a model or mocking
 * localStorage.
 */
import { describe, it, expect } from 'vitest';
import { decideBoot, DEV_NIGHT_HOUR } from '$lib/model/aero-window-boot';

const base = { isDev: false, hasWindow: true, hasPersisted: false, syncToRealTime: true };

describe('dev deep-night override', () => {
	it('fires on a dev box with nothing persisted', () => {
		expect(decideBoot({ ...base, isDev: true }).applyDevNightOverride).toBe(true);
	});

	it('NEVER fires in production, which is what keeps it off the Pi', () => {
		expect(decideBoot({ ...base, isDev: false }).applyDevNightOverride).toBe(false);
	});

	it('does not fire for a dev box that DOES have persisted state', () => {
		// The regression: this keyed off `Object.keys(persisted).length === 0`,
		// but load() strips fields it refuses to restore, so a browser with
		// plenty stored could load as {} — and the override then forced Real
		// Time off for someone who had deliberately set it.
		expect(
			decideBoot({ ...base, isDev: true, hasPersisted: true }).applyDevNightOverride,
		).toBe(false);
	});

	it('does not fire during SSR', () => {
		expect(
			decideBoot({ ...base, isDev: true, hasWindow: false }).applyDevNightOverride,
		).toBe(false);
	});

	it('pins a genuinely night-time hour', () => {
		// A daytime constant here would silently disable the whole point of the
		// override — seeing the night-light pipeline by default.
		expect(DEV_NIGHT_HOUR).toBeGreaterThanOrEqual(20);
		expect(DEV_NIGHT_HOUR).toBeLessThanOrEqual(23);
	});
});

describe('wall-clock sync at boot', () => {
	it('runs when Real Time is on', () => {
		expect(decideBoot(base).syncTimeFromSystem).toBe(true);
	});

	it('is gated on syncToRealTime, matching the recurring sync', () => {
		// Ungated, boot clobbered timeOfDay and then froze, killing any
		// persisted syncToRealTime:false kiosk's show-opening time.
		expect(decideBoot({ ...base, syncToRealTime: false }).syncTimeFromSystem).toBe(false);
	});

	it('never runs during SSR', () => {
		expect(decideBoot({ ...base, hasWindow: false }).syncTimeFromSystem).toBe(false);
	});

	it('is suppressed by the dev override rather than undoing it', () => {
		// THE mutually-exclusive pair: one pins 22:00, the other overwrites it
		// with the real hour. Previously the exclusion was implicit — it held
		// only because the override had just mutated syncToRealTime and the
		// gate re-read it. Order-dependence like that is one refactor away
		// from silently re-enabling both.
		const d = decideBoot({ ...base, isDev: true, syncToRealTime: true });
		expect(d.applyDevNightOverride).toBe(true);
		expect(d.syncTimeFromSystem).toBe(false);
	});

	it('never returns both gates true, for any input', () => {
		for (const isDev of [true, false]) {
			for (const hasWindow of [true, false]) {
				for (const hasPersisted of [true, false]) {
					for (const syncToRealTime of [true, false]) {
						const d = decideBoot({ isDev, hasWindow, hasPersisted, syncToRealTime });
						expect(
							d.applyDevNightOverride && d.syncTimeFromSystem,
							JSON.stringify({ isDev, hasWindow, hasPersisted, syncToRealTime }),
						).toBe(false);
					}
				}
			}
		}
	});
});
