import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Weather must change how much cloud there is, not only how it is lit.
 *
 * Measured before this existed: 439 sprites on `clear`, and 439 on `storm` —
 * identical in all five weathers. The deck was fully lit-reactive and entirely
 * population-static, so a clear day carried a storm's worth of cloud and a
 * storm added nothing but darkness.
 *
 * The counts live inside an `{@attach}` callback that needs a WebGL context, so
 * this asserts the WIRING rather than running the builder: that the coverage
 * scalar exists, is applied to each tier, and is in the rebuild effect. The
 * live sprite counts are checked by `tools/probe-layers.mjs`, which has a real
 * browser and reports them per weather.
 */
const SRC = readFileSync('src/lib/display/world/Clouds.svelte', 'utf8');
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('cloud coverage responds to weather', () => {
	it('declares a coverage scalar for every weather', () => {
		for (const w of ['clear', 'cloudy', 'rain', 'overcast', 'storm']) {
			expect(code, `no coverage entry for ${w}`).toMatch(new RegExp(`${w}:\\s*[\\d.]+`));
		}
	});

	it('scales all three tiers by it', () => {
		const tiers = code.match(/const (distantCount|nearCount|cirrusCount) = [\s\S]*?\);/g) ?? [];
		expect(tiers.length, 'expected three cloud tiers').toBe(3);
		for (const t of tiers) {
			expect(t, `a tier ignores coverageScale:\n${t}`).toContain('coverageScale');
		}
	});

	it('rebuilds the deck when the weather changes', () => {
		// The builder is not reactive; an explicit read in the effect is what
		// re-rolls the population. Without this the scalar changes and nothing
		// redraws until some other input happens to move.
		const effect = code.slice(code.lastIndexOf('$effect'));
		expect(effect, 'coverageScale is not in the rebuild effect').toContain('void coverageScale');
	});

	it('keeps clear skies emptier than storms', () => {
		const val = (w: string) => Number(new RegExp(`${w}:\\s*([\\d.]+)`).exec(code)?.[1]);
		expect(val('clear')).toBeLessThan(val('cloudy'));
		expect(val('cloudy')).toBeLessThan(val('rain'));
		expect(val('rain')).toBeLessThan(val('overcast'));
		expect(val('overcast')).toBeLessThan(val('storm'));
	});
});
