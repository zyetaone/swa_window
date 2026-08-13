/**
 * flyTo fleet contract — human/ops scene changes must not desync a corridor.
 *
 * A panorama leader (center) broadcasts director_decision and schedules its
 * own flyTo at the broadcast transitionAtMs, so leader and edge panes move
 * in wall-clock lock-step. Solo has no followers: no broadcast, immediate
 * flight. Edge followers no-op and only move via applyScene (fleet client
 * path).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { LOCATION_IDS } from '$content/locations';
import { applyConfigPatch } from '$lib/model/config-tree.svelte';

const [, AWAY] = [...LOCATION_IDS];

describe('AeroWindow.flyTo fleet gate', () => {
	let model: AeroWindow;
	let broadcasts: Array<Record<string, unknown>>;

	beforeEach(() => {
		// Reset role to solo so each test starts clean (config is a process singleton).
		applyConfigPatch('camera.parallax.role', 'solo');
		model = new AeroWindow();
		broadcasts = [];
		model.setFleetBroadcast((msg) => {
			broadcasts.push(msg as Record<string, unknown>);
		});
	});

	afterEach(() => {
		model.setFleetBroadcast(null);
		applyConfigPatch('camera.parallax.role', 'solo');
		model.destroy();   // cancels any pending lock-step cruise timer
		vi.useRealTimers();
	});

	it('leader (solo) flies immediately — no followers to broadcast to', () => {
		expect(model.config.camera.parallax.role).toBe('solo');
		model.flyTo(AWAY);
		expect(model.flight.flightMode).not.toBe('orbit');
		expect(model.flight.cruiseDestinationName).toBeTruthy();
		expect(broadcasts).toHaveLength(0);
	});

	it('leader (center) broadcasts the same wire shape as autopilot', () => {
		applyConfigPatch('camera.parallax.role', 'center');
		model.flyTo(AWAY);
		expect(broadcasts).toHaveLength(1);
		expect(broadcasts[0].v).toBe(2);
		expect(broadcasts[0].type).toBe('director_decision');
		expect(broadcasts[0].locationId).toBe(AWAY);
		expect(broadcasts[0].weather).toBe(model.weather);
	});

	it('leader (center) schedules its own flyTo at the broadcast transitionAtMs', () => {
		vi.useFakeTimers();
		applyConfigPatch('camera.parallax.role', 'center');
		const flySpy = vi.spyOn(model.flight, 'flyTo');

		model.flyTo(AWAY);
		expect(broadcasts).toHaveLength(1);
		expect(broadcasts[0].scenarioId).toBe('manual');
		const transitionAtMs = broadcasts[0].transitionAtMs as number;

		// Lock-step: the leader must NOT cruise before the shared instant.
		expect(flySpy).not.toHaveBeenCalled();
		expect(model.flight.flightMode).toBe('orbit');

		vi.advanceTimersByTime(transitionAtMs - Date.now() + 1);
		expect(flySpy).toHaveBeenCalledTimes(1);
		expect(model.flight.flightMode).not.toBe('orbit');
	});

	it('leader (center) without a fleet client flies immediately — no broadcast possible', () => {
		applyConfigPatch('camera.parallax.role', 'center');
		model.setFleetBroadcast(null);
		model.flyTo(AWAY);
		expect(model.flight.flightMode).not.toBe('orbit');
		expect(model.flight.cruiseDestinationName).toBeTruthy();
		expect(broadcasts).toHaveLength(0);
	});

	it('follower (left) does not fly and does not broadcast', () => {
		applyConfigPatch('camera.parallax.role', 'left');
		const modeBefore = model.flight.flightMode;
		model.flyTo(AWAY);
		expect(model.flight.flightMode).toBe(modeBefore);
		expect(model.flight.cruiseDestinationName).toBeNull();
		expect(broadcasts).toHaveLength(0);
	});

	it('follower (right) does not fly', () => {
		applyConfigPatch('camera.parallax.role', 'right');
		model.flyTo(AWAY);
		expect(model.flight.flightMode).toBe('orbit');
		expect(broadcasts).toHaveLength(0);
	});

	it('applyScene still flies on a follower (fleet receive path)', () => {
		applyConfigPatch('camera.parallax.role', 'left');
		model.applyScene(AWAY);
		expect(model.flight.flightMode).not.toBe('orbit');
		// applyScene must not re-broadcast (would loop)
		expect(broadcasts).toHaveLength(0);
	});

	it('records flyTo_ignored telemetry on follower', () => {
		applyConfigPatch('camera.parallax.role', 'left');
		const spy = vi.spyOn(model.telemetry, 'recordEvent');
		model.flyTo(AWAY);
		expect(spy).toHaveBeenCalledWith(
			'info',
			expect.objectContaining({ event: 'flyTo_ignored', reason: 'follower', locationId: AWAY, role: 'left' }),
		);
		spy.mockRestore();
	});
});
