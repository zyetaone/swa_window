/**
 * Pure fleet payload builders — no AeroWindow instance required.
 */
import { describe, it, expect, vi } from 'vitest';
import {
	buildAmbientJitterPatch,
	broadcastAmbientJitter,
	broadcastLocationDecision,
} from '$lib/model/aero-window-fleet';

describe('buildAmbientJitterPatch', () => {
	it('maps known atmosphere paths', () => {
		const patch = buildAmbientJitterPatch([
			{ path: 'atmosphere.clouds.density', value: 0.5 },
			{ path: 'atmosphere.clouds.speed', value: 0.8 },
			{ path: 'atmosphere.haze.amount', value: 0.1 },
			{ path: 'weather', value: 'clear' },
			{ path: 'world.qualityMode', value: 'ultra' }, // ignored
		]);
		expect(patch).toEqual({
			cloudDensity: 0.5,
			cloudSpeed: 0.8,
			hazeAmount: 0.1,
			weather: 'clear',
		});
	});

	it('returns null when nothing maps', () => {
		expect(buildAmbientJitterPatch([{ path: 'world.qualityMode', value: 'ultra' }])).toBeNull();
	});
});

describe('broadcastAmbientJitter', () => {
	it('no-ops for solo / missing broadcast', () => {
		const fn = vi.fn();
		expect(broadcastAmbientJitter(null, 'center', 'g', [{ path: 'weather', value: 'rain' }])).toBe(false);
		expect(broadcastAmbientJitter(fn, 'solo', 'g', [{ path: 'weather', value: 'rain' }])).toBe(false);
		expect(fn).not.toHaveBeenCalled();
	});

	it('sends set_config for center leader', () => {
		const fn = vi.fn();
		expect(
			broadcastAmbientJitter(
				fn,
				'center',
				'wall-1',
				[{ path: 'atmosphere.clouds.density', value: 0.4 }],
				1_700_000_000_000,
			),
		).toBe(true);
		expect(fn).toHaveBeenCalledWith({
			v: 2,
			type: 'set_config',
			patch: { cloudDensity: 0.4 },
			decidedAtMs: 1_700_000_000_000,
			groupId: 'wall-1',
		});
	});
});

describe('broadcastLocationDecision', () => {
	it('returns null for non-center', () => {
		const fn = vi.fn();
		expect(
			broadcastLocationDecision(fn, 'solo', 'g', {
				locationId: 'dallas',
				scenarioId: 'manual',
				weather: 'cloudy',
			}),
		).toBeNull();
		expect(fn).not.toHaveBeenCalled();
	});

	it('returns transitionAtMs and wires director_decision', () => {
		const fn = vi.fn();
		const now = 1_700_000_000_000;
		const at = broadcastLocationDecision(fn, 'center', 'wall-1', {
			locationId: 'dubai',
			scenarioId: 'autopilot',
			weather: 'clear',
			nowMs: now,
			delayMs: 2500,
		});
		expect(at).toBe(now + 2500);
		expect(fn).toHaveBeenCalledWith({
			v: 2,
			type: 'director_decision',
			scenarioId: 'autopilot',
			locationId: 'dubai',
			weather: 'clear',
			decidedAtMs: now,
			transitionAtMs: now + 2500,
			groupId: 'wall-1',
		});
	});
});
