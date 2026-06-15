import { describe, it, expect } from 'vitest';
import {
	STREET_CORE,
	STREET_HALO,
	CITY_GLOW,
	CITY_SODIUM,
	CITY_AMBER,
	CITY_WARM_WHITE,
	hexOf,
	type Rgb,
} from '$content/palettes';

describe('city-lights palette', () => {
	it('hexOf packs a 0..1 rgb tuple into 0xRRGGBB', () => {
		expect(hexOf([1, 1, 1])).toBe(0xffffff);
		expect(hexOf([0, 0, 0])).toBe(0x000000);
		expect(hexOf([1, 0, 0])).toBe(0xff0000);
		expect(hexOf([0, 0, 1])).toBe(0x0000ff);
	});

	it('street neon hexes are byte-identical to the original OsmRoads literals', () => {
		// Locks the "zero visual change" contract from the palette extraction: any
		// future tweak to STREET_CORE / STREET_HALO that would shift the rendered
		// road colour off 0xffc77a / 0xdca860 fails here, on purpose.
		expect(hexOf(STREET_CORE)).toBe(0xffc77a);
		expect(hexOf(STREET_HALO)).toBe(0xdca860);
	});

	it('the dome glow tint equals the original CityGlowDome Color', () => {
		expect(CITY_GLOW).toEqual([1.0, 0.55, 0.2]);
	});

	it('canonical warm stops ascend in luminance (sodium → amber → warm-white)', () => {
		const lum = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
		expect(lum(CITY_SODIUM)).toBeLessThan(lum(CITY_AMBER));
		expect(lum(CITY_AMBER)).toBeLessThan(lum(CITY_WARM_WHITE));
	});
});
