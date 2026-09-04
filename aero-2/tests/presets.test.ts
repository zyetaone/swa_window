import { describe, it, expect } from 'vitest';
import { SCENE_PRESETS } from '#lib/settings/presets.js';
import { PaneSettings } from '#lib/settings/settings.svelte.js';
import { resolveLocalHours } from '#lib/display/world/sun.js';

describe('Scene Composition Presets', () => {
	it('defines all required preset metadata and config fields', () => {
		expect(SCENE_PRESETS.length).toBeGreaterThan(3);
		for (const preset of SCENE_PRESETS) {
			expect(preset.id).toBeTruthy();
			expect(preset.name).toBeTruthy();
			expect(preset.icon).toBeTruthy();
			expect(preset.badge).toBeTruthy();
			expect(preset.config).toBeDefined();
		}
	});

	it('successfully applies preset to PaneSettings instance', () => {
		const settings = new PaneSettings();
		settings.applyPreset('gulf-midnight', 0);
		expect(settings.place.id).toBe('dubai');
		expect(settings.weather).toBe('rain');
	});

	it('gracefully handles unknown preset ids', () => {
		const settings = new PaneSettings();
		const initialPlace = settings.place.id;
		settings.applyPreset('nonexistent-preset', 0);
		expect(settings.place.id).toBe(initialPlace);
	});

	/**
	 * The presets were authored as `clockOffsetH: 12.0, // midnight darkness`.
	 * clockOffsetH is a DELTA from real local time, so that scene was midnight
	 * only when the real local hour happened to be noon, and drifted hour by
	 * hour on a kiosk that runs all day. Every card's lighting claim was
	 * coincidental. Sampling around the clock is the whole point of the test.
	 */
	it('lands on the authored local hour whatever time it really is', () => {
		for (const preset of SCENE_PRESETS) {
			const want = preset.config.localHour;
			if (want === undefined) continue;

			for (let hour = 0; hour < 24; hour += 3) {
				const wallSec = 1_787_650_000 - (1_787_650_000 % 86_400) + hour * 3600;
				const s = new PaneSettings();
				s.applyPreset(preset.id, wallSec);

				const got = resolveLocalHours(wallSec, s.place.utcOffset + s.clockOffsetH);
				const diff = (((got - want) % 24) + 24) % 24;
				const circular = Math.min(diff, 24 - diff);
				// 15-minute grid, so 0.125 h is the worst honest miss.
				expect(circular, `${preset.id} at real hour ${hour}`).toBeLessThan(0.2);
			}
		}
	});

	/**
	 * `rain?: boolean` could not express the other three conditions, so the
	 * storm preset resolved to 'rain': turbulence 0.38 instead of 1.0, rain
	 * glass 0.72 instead of 1, and no lightning at all.
	 */
	it('lets a storm preset actually be a storm', () => {
		const s = new PaneSettings();
		s.applyPreset('storm-transit', 0);
		expect(s.weather).toBe('storm');
	});

	it('names a place the card would recognise', () => {
		for (const preset of SCENE_PRESETS) {
			const s = new PaneSettings();
			s.applyPreset(preset.id, 0);
			expect(preset.config.placeId, preset.id).toBe(s.place.id);
		}
	});

	/** /admin links every preset as `/?preset=<id>`; nothing parsed the param. */
	it('is reachable from the URL, which is how /admin links it', () => {
		for (const preset of SCENE_PRESETS) {
			const s = new PaneSettings();
			s.applyUrl(new URL(`http://localhost/?preset=${preset.id}`));
			expect(s.place.id, preset.id).toBe(preset.config.placeId);
		}
	});
});
