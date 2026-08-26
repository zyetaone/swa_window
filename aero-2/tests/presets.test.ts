import { describe, it, expect } from 'vitest';
import { SCENE_PRESETS } from '#lib/settings/presets.js';
import { PaneSettings } from '#lib/settings/settings.svelte.js';

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
		expect(settings.place.id).not.toBe('tokyo');

		settings.applyPreset('tokyo-midnight');
		expect(settings.place.id).toBe('dubai');
		expect(settings.weather).toBe('rain');
		expect(settings.cesiumViirsBrightness).toBe(3.5);
	});

	it('gracefully handles unknown preset ids', () => {
		const settings = new PaneSettings();
		const initialPlace = settings.place.id;
		settings.applyPreset('nonexistent-preset');
		expect(settings.place.id).toBe(initialPlace);
	});
});
