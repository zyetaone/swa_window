import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	tryConsumeReloadBudget,
	reloadsRemaining,
	MAX_RELOADS_PER_HOUR
} from '#lib/display/reload-budget.js';

/**
 * The watchdog reloads to escape a stall. Without a cap it strobes.
 *
 * A reload only helps a TRANSIENT fault, and at the moment of detection a
 * transient one is indistinguishable from a permanent one — a Pi whose GPU
 * cannot initialise comes back from the reload into the identical state. So the
 * uncapped version flashes the wall white every sixty seconds, all night.
 *
 * v1 capped this at three per hour and the rewrite inherited the watchdog
 * without the cap. These assert the cap, and that it fails OPEN when storage is
 * unavailable, because no recovery at all is worse than an uncapped one.
 */
beforeEach(() => {
	sessionStorage.clear();
	vi.unstubAllGlobals();
});

describe('reload budget', () => {
	it('allows exactly the hourly maximum, then refuses', () => {
		const now = 1_770_000_000_000;
		for (let i = 1; i <= MAX_RELOADS_PER_HOUR; i++) {
			expect(tryConsumeReloadBudget(now + i * 1000), `reload ${i} was refused`).toBe(true);
		}
		expect(
			tryConsumeReloadBudget(now + 10_000),
			'a persistent fault got a fourth reload and would strobe forever'
		).toBe(false);
	});

	it('consumes on check, so a caller cannot loop by asking twice', () => {
		const now = 1_770_000_000_000;
		expect(reloadsRemaining(now)).toBe(MAX_RELOADS_PER_HOUR);
		tryConsumeReloadBudget(now);
		expect(reloadsRemaining(now)).toBe(MAX_RELOADS_PER_HOUR - 1);
	});

	it('forgets reloads older than the hour', () => {
		const now = 1_770_000_000_000;
		for (let i = 0; i < MAX_RELOADS_PER_HOUR; i++) tryConsumeReloadBudget(now + i);
		expect(tryConsumeReloadBudget(now + 1000)).toBe(false);

		// Past the last entry's own hour, not the first's — the window slides per
		// entry, so `now + 3_600_001` would still hold the third one (logged at
		// now+2, and therefore 3_599_999 ms old). An off-by-one here would have
		// asserted the wrong thing and passed for the wrong reason.
		const later = now + MAX_RELOADS_PER_HOUR + 3_600_001;
		expect(reloadsRemaining(later)).toBe(MAX_RELOADS_PER_HOUR);
		expect(tryConsumeReloadBudget(later)).toBe(true);
	});

	/**
	 * Fails OPEN, deliberately.
	 *
	 * The kiosk runs Chromium with `--incognito`, which does provide
	 * sessionStorage — but a quota error or a hardened profile can make it
	 * throw. An uncapped recovery is bad; a device that can never recover is
	 * worse, so an unreadable budget must not disable the watchdog.
	 */
	it('still permits a reload when sessionStorage throws', () => {
		vi.stubGlobal('sessionStorage', {
			getItem() {
				throw new Error('storage disabled');
			},
			setItem() {
				throw new Error('storage disabled');
			},
			clear() {}
		});
		expect(tryConsumeReloadBudget(1_770_000_000_000)).toBe(true);
	});

	it('survives a corrupted log rather than throwing', () => {
		sessionStorage.setItem('aero.reload.log', '{"not":"an array"}');
		expect(tryConsumeReloadBudget(1_770_000_000_000)).toBe(true);
	});
});
