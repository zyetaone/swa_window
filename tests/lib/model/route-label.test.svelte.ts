/**
 * Blind / whisper route label: From → To after a hop starts.
 */
import { describe, it, expect } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';

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
		model.flyTo('dallas');
		expect(model.routeFromName).toBe(from);
		expect(model.routeToName).toBe('Dallas');
		expect(model.routeLabel).toBe(`${from} → Dallas`);
	});

	it('stamps route on applyScene (fleet follower path)', () => {
		const model = new AeroWindow();
		model.applyConfigPatch('camera.parallax.role', 'left');
		const from = model.currentLocation.name;
		model.applyScene('dubai');
		expect(model.routeFromName).toBe(from);
		expect(model.routeToName).toBe('Dubai');
		expect(model.routeLabel).toBe(`${from} → Dubai`);
	});
});
