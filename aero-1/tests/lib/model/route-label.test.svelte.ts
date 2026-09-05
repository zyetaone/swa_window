/**
 * Blind / whisper route label: From → To after a hop starts.
 *
 * ─── These tests must not name a fixed destination ──────────────────────────
 * A fresh AeroWindow boots to `pickDailyShow()`, which is seeded from the WALL
 * CLOCK (the 2-hourly UTC rotation) — deliberately, so three panes agree
 * without exchanging a message. That makes the boot location a different city
 * depending on when the suite runs.
 *
 * Both cases below used to fly to a hard-coded city, so whenever the rotation
 * happened to boot on that same city the hop was a no-op, routeLabel collapsed
 * to the bare name, and the test failed. Nothing was broken — the assertion
 * just assumed a starting point it did not control.
 *
 * That matters more here than a normal flake: CI gates the release branch, so
 * a time-dependent failure blocks the fleet at random hours of the day.
 *
 * Each test now picks a destination it has confirmed differs from where it
 * actually booted.
 */
import { describe, it, expect } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { LOCATIONS } from '$content/locations';

/** A catalogue entry that is NOT where this model booted. */
function elsewhere(model: AeroWindow) {
	const target = LOCATIONS.find((l) => l.id !== model.location);
	if (!target) throw new Error('catalogue needs 2+ locations for a route test');
	return target;
}

describe('AeroWindow routeLabel', () => {
	it('is just the current place before any cruise', () => {
		const model = new AeroWindow();
		expect(model.routeFromName).toBeNull();
		expect(model.routeToName).toBeNull();
		expect(model.routeLabel).toBe(model.currentLocation.name);
	});

	it('stamps From → To on flyTo (solo leader)', () => {
		const model = new AeroWindow();
		// Default role is solo — group leader; flyTo is productive.
		model.applyConfigPatch('camera.parallax.role', 'solo');
		const from = model.currentLocation.name;
		const to = elsewhere(model);
		model.flyTo(to.id);
		expect(model.routeFromName).toBe(from);
		expect(model.routeToName).toBe(to.name);
		expect(model.routeLabel).toBe(`${from} → ${to.name}`);
	});

	it('stamps route on applyScene (fleet follower path)', () => {
		const model = new AeroWindow();
		model.applyConfigPatch('camera.parallax.role', 'left');
		const from = model.currentLocation.name;
		const to = elsewhere(model);
		model.applyScene(to.id);
		expect(model.routeFromName).toBe(from);
		expect(model.routeToName).toBe(to.name);
		expect(model.routeLabel).toBe(`${from} → ${to.name}`);
	});
});
