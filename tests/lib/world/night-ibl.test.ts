/**
 * night-ibl — opt-in dynamic environment mapping for the buildings tileset.
 *
 * These tests pin the SAFETY properties, which are what make it acceptable to
 * land a rendering prototype on the ship path at all: it must be a no-op when
 * the flag is off, a no-op on a Cesium build without the API, and it must never
 * throw into the scene setup path (a throw there loses the whole globe, not
 * just the lighting).
 */
import { describe, it, expect } from 'vitest';
import {
	enableNightIbl,
	disableNightIbl,
	nightIblSupported,
	NIGHT_IBL_DEFAULTS,
} from '$lib/world/night-ibl';

/** Minimal stand-in for Cesium's Color.fromCssColorString. */
const FakeCesium = {
	Color: { fromCssColorString: (css: string) => ({ css }) },
} as never;

/** A tileset shaped like Cesium 1.125+, exposing environmentMapManager. */
function modernTileset() {
	return {
		environmentMapManager: {
			enabled: false,
			atmosphereScatteringIntensity: 1,
			groundAlbedo: 0,
			maximumSecondsDifference: 0,
			groundColor: null as unknown,
		},
	} as never;
}

/** A tileset from an older Cesium, with no such property. */
const legacyTileset = {} as never;

describe('night-ibl', () => {
	it('reports support only when the API is present', () => {
		expect(nightIblSupported(modernTileset())).toBe(true);
		expect(nightIblSupported(legacyTileset)).toBe(false);
		expect(nightIblSupported(null)).toBe(false);
	});

	it('applies the night tuning when enabled', () => {
		const ts = modernTileset();
		expect(enableNightIbl(FakeCesium, ts)).toBe(true);

		const m = (ts as unknown as { environmentMapManager: Record<string, unknown> })
			.environmentMapManager;
		expect(m.enabled).toBe(true);
		expect(m.atmosphereScatteringIntensity).toBe(NIGHT_IBL_DEFAULTS.atmosphereScatteringIntensity);
		expect(m.groundAlbedo).toBe(NIGHT_IBL_DEFAULTS.groundAlbedo);
		expect(m.maximumSecondsDifference).toBe(NIGHT_IBL_DEFAULTS.maximumSecondsDifference);
		expect(m.groundColor).toEqual({ css: NIGHT_IBL_DEFAULTS.groundColorCss });
	});

	// The compatibility contract: an older Cesium must degrade, not crash.
	it('is a silent no-op on a Cesium without the API', () => {
		expect(enableNightIbl(FakeCesium, legacyTileset)).toBe(false);
		expect(disableNightIbl(legacyTileset)).toBe(false);
	});

	it('is a no-op with no tileset (buildings disabled or Ion token missing)', () => {
		expect(enableNightIbl(FakeCesium, null)).toBe(false);
		expect(disableNightIbl(null)).toBe(false);
	});

	it('survives a bad ground colour instead of taking down scene setup', () => {
		const throwing = {
			Color: { fromCssColorString: () => { throw new Error('bad css'); } },
		} as never;
		const ts = modernTileset();
		expect(() => enableNightIbl(throwing, ts)).not.toThrow();
		// The other tuning still applied — only the colour was skipped.
		const m = (ts as unknown as { environmentMapManager: Record<string, unknown> })
			.environmentMapManager;
		expect(m.enabled).toBe(true);
	});

	it('can be toggled off again for A/B comparison', () => {
		const ts = modernTileset();
		enableNightIbl(FakeCesium, ts);
		expect(disableNightIbl(ts)).toBe(true);
		const m = (ts as unknown as { environmentMapManager: Record<string, unknown> })
			.environmentMapManager;
		expect(m.enabled).toBe(false);
	});

	it('defaults raise the environment contribution above neutral', () => {
		// At night the direct sun term is ~0, so a value of 1.0 would leave
		// facades as flat ambient — the problem this exists to fix.
		expect(NIGHT_IBL_DEFAULTS.atmosphereScatteringIntensity).toBeGreaterThan(1);
		expect(NIGHT_IBL_DEFAULTS.groundAlbedo).toBeGreaterThan(0);
		expect(NIGHT_IBL_DEFAULTS.groundAlbedo).toBeLessThanOrEqual(1);
	});
});
