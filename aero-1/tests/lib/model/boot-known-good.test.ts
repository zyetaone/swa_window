/**
 * Boot must land in a known-good state, not in whoever-touched-it-last.
 *
 * Two settings kept coming back wrong on the wall even though their code
 * defaults were already correct, because a persisted value is applied AFTER the
 * default — so changing the default could never fix a device that had already
 * stored the other value. These tests pin the two that must reset.
 */
import { describe, it, expect } from 'vitest';
import { AMBIENT_PERSIST_PATHS, PEER_SYNC_PATHS } from '$lib/model/peer-sync-paths';
import { savePersistedState, loadPersistedState, STORAGE_KEY, type PersistedState } from '$lib/model/persistence';

describe('window frame resets every boot', () => {
	it('is not persisted', () => {
		// The frame is PHYSICAL on this wall — the panel bezel is the surround,
		// so the drawn oval doubles it. One stray toggle must not outlive the
		// session.
		expect(AMBIENT_PERSIST_PATHS).not.toContain('shell.windowFrame');
	});

	it('is still peer-synced, so admin can toggle it live', () => {
		// Resetting on boot must not cost the operator the ability to turn it on
		// for a demo — those are different concerns and only one is being removed.
		expect(PEER_SYNC_PATHS).toContain('shell.windowFrame');
	});
});

describe('Real Time comes back on every boot', () => {
	it('is never written to storage', () => {
		// Freezing the sky is fine for a demo and disastrous to persist: an
		// unattended wall would show the same frozen afternoon indefinitely, and
		// a frozen sky looks like a working sky until someone notices it has not
		// moved all week.
		const state = {
			altitude: 30000,
			cloudDensity: 0.5,
			buildingsEnabled: true,
			showClouds: true,
			syncToRealTime: false,
			ambient: {},
		} as PersistedState;

		savePersistedState(state);

		const raw = localStorage.getItem(STORAGE_KEY);
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw as string);
		expect(parsed).not.toHaveProperty('syncToRealTime');
		// The genuinely useful operator preference beside it still survives.
		expect(parsed.altitude).toBe(30000);
	});

	it('ignores a legacy blob that already has the wrong values stored', () => {
		// This is the case that actually recovers the fielded Pis. Not writing
		// the value is not enough on its own: devices already hold
		// syncToRealTime:false and shell.windowFrame:true from before this
		// change, and a stored value is applied AFTER the code default. If load
		// still honoured them, those devices would stay wrong through every
		// future reboot and no default change could reach them.
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				altitude: 31000,
				syncToRealTime: false,
				ambient: { 'shell.windowFrame': true, 'world.nightLightIntensity': 2 },
			}),
		);

		const loaded = loadPersistedState();

		expect(loaded.syncToRealTime).toBeUndefined();
		expect(loaded.ambient?.['shell.windowFrame']).toBeUndefined();
		// Genuine site tuning beside them still comes back — this removes two
		// modes, not the operator's calibration work.
		expect(loaded.altitude).toBe(31000);
		expect(loaded.ambient?.['world.nightLightIntensity']).toBe(2);
	});

	it('never writes location or weather either', () => {
		// Same rule, already established — boot opens from the rotation seed.
		savePersistedState({
			location: 'dubai',
			weather: 'rain',
			altitude: 28000,
			cloudDensity: 0.3,
			buildingsEnabled: true,
			showClouds: true,
			ambient: {},
		} as PersistedState);

		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
		expect(parsed).not.toHaveProperty('location');
		expect(parsed).not.toHaveProperty('weather');
	});
});
