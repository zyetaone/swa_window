/**
 * Persist map pure helpers (restore + snapshot shape).
 */
import { describe, it, expect, vi } from 'vitest';
import {
	applyPersistedToHost,
	buildPersistedSnapshot,
} from '$lib/model/aero-window-persist-map';

describe('applyPersistedToHost', () => {
	it('restores altitude via flight clamp, not setAltitude override', () => {
		const setAltitude = vi.fn();
		const applyConfigPatch = vi.fn(() => true);
		applyPersistedToHost(
			{
				config: { camera: { altitude: { min: 10_000, max: 65_000 } } },
				flight: { setAltitude },
				applyConfigPatch,
			},
			{
				altitude: 40_000,
				cloudDensity: 0.7,
				buildingsEnabled: false,
				showClouds: true,
				ambient: { 'world.nightLightIntensity': 3 },
			},
		);
		expect(setAltitude).toHaveBeenCalledWith(40_000, { min: 10_000, max: 65_000 });
		expect(applyConfigPatch).toHaveBeenCalledWith('atmosphere.clouds.density', 0.7);
		expect(applyConfigPatch).toHaveBeenCalledWith('world.buildingsEnabled', false);
		expect(applyConfigPatch).toHaveBeenCalledWith('world.showClouds', true);
		expect(applyConfigPatch).toHaveBeenCalledWith('world.nightLightIntensity', 3);
	});

	it('ignores empty ambient and missing fields', () => {
		const setAltitude = vi.fn();
		const applyConfigPatch = vi.fn(() => true);
		applyPersistedToHost(
			{
				config: { camera: { altitude: { min: 10_000, max: 65_000 } } },
				flight: { setAltitude },
				applyConfigPatch,
			},
			{},
		);
		expect(setAltitude).not.toHaveBeenCalled();
		expect(applyConfigPatch).not.toHaveBeenCalled();
	});
});

describe('buildPersistedSnapshot', () => {
	it('includes named fields + ambient paths that are primitives', () => {
		const snap = buildPersistedSnapshot({
			config: {
				atmosphere: { clouds: { density: 0.55 } },
				world: {
					buildingsEnabled: true,
					showClouds: false,
					nightLightIntensity: 4,
					qualityMode: 'performance',
				},
			},
			flight: { altitude: 32_000 },
		});
		expect(snap.altitude).toBe(32_000);
		expect(snap.cloudDensity).toBe(0.55);
		expect(snap.buildingsEnabled).toBe(true);
		expect(snap.showClouds).toBe(false);
		expect(snap.ambient['world.nightLightIntensity']).toBe(4);
		expect(snap.ambient['world.qualityMode']).toBe('performance');
		// Named fields must not double-write into ambient (AMBIENT_PERSIST filter).
		expect(snap.ambient['world.buildingsEnabled']).toBeUndefined();
		expect(snap.ambient['world.showClouds']).toBeUndefined();
	});
});
