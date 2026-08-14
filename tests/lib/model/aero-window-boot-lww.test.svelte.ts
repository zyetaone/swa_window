/**
 * Boot-time CRDT stamping — regression tests.
 *
 * A rebooting Pi must not stamp its boot-time config applications
 * (persisted restore, weather-recipe sync) with the current wall-clock.
 * An admin push issued while the Pi was OFFLINE carries an older
 * timestamp; a fresh boot stamp would win LWW and silently revert the
 * push on every reboot once a peer replays it.
 *
 * Separate file from aero-window-boot.test.svelte.ts on purpose: the
 * CRDT store is a module singleton, and that file's arrival-jitter test
 * legitimately stamps atmosphere.clouds.* with Date.now() — which would
 * mask the regression these tests guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AeroWindow } from '$lib/model/aero-window.svelte';
import { applyConfigPatch } from '$lib/model/config-tree.svelte';
import { STORAGE_KEY } from '$lib/model/persistence';
import { daySeed } from '$lib/world/prng';

beforeEach(() => {
	localStorage.clear();
});

describe('AeroWindow boot CRDT stamping', () => {
	it('persisted restore applies unstamped — an older offline admin push still wins LWW', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			cloudDensity: 0.33,
			dayKey: daySeed(),
		}));
		const bootedAt = Date.now();
		const model = new AeroWindow();
		expect(model.config.atmosphere.clouds.density).toBe(0.33);

		// Push issued 60 s BEFORE the boot, while the Pi was offline.
		const ok = applyConfigPatch('atmosphere.clouds.density', 0.5, {
			remote: { timestamp: bootedAt - 60_000, sourceId: 'admin-offline' },
		});
		expect(ok).toBe(true);
		expect(model.config.atmosphere.clouds.density).toBe(0.5);
	});

	it('boot weather-recipe sync applies unstamped — an older offline push to atmosphere.weather.* wins', () => {
		// Location/weather are never restored (boot owns the scene via
		// pickDailyShow). Construction still runs #syncWeatherConfig for the
		// show's weather; that path must stay unstamped so an offline admin
		// push to atmosphere.weather.* still wins LWW.
		const bootedAt = Date.now();
		const model = new AeroWindow();
		expect(model.weather).toBeTruthy();

		const ok = applyConfigPatch('atmosphere.weather.rainOpacity', 0.42, {
			remote: { timestamp: bootedAt - 60_000, sourceId: 'admin-offline' },
		});
		expect(ok).toBe(true);
		expect(model.config.atmosphere.weather.rainOpacity).toBe(0.42);
	});

	it('persisted ambient restore applies unstamped — an older offline ambient push still wins LWW', () => {
		// Same guarantee as the cloudDensity test above, but for the ambient
		// peer-sync paths (world.*/shell.*/atmosphere.haze.*) that persistence
		// now carries across reboots.
		localStorage.setItem(STORAGE_KEY, JSON.stringify({
			ambient: { 'world.nightLightIntensity': 3.5 },
			dayKey: daySeed(),
		}));
		const bootedAt = Date.now();
		const model = new AeroWindow();
		expect(model.config.world.nightLightIntensity).toBe(3.5);

		const ok = applyConfigPatch('world.nightLightIntensity', 4.5, {
			remote: { timestamp: bootedAt - 60_000, sourceId: 'admin-offline' },
		});
		expect(ok).toBe(true);
		expect(model.config.world.nightLightIntensity).toBe(4.5);
	});
});
