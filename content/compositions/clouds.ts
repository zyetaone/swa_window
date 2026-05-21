/**
 * Cloud compositions — authored sky moods.
 *
 * Each composition is a recipe describing how the cloud renderer
 * (scene/effects/clouds/ArtsyClouds.svelte) should distribute its horizon
 * and mid-band clouds. Without these, every "clear" day looks identical
 * and every storm looks identical — uniform rand() across the band. With
 * these, the sky picks one of N painterly moods on each weather change.
 *
 * Authoring rules:
 *   - id is kebab-case
 *   - weatherCompat is the only filter the picker uses
 *   - all numeric ranges are [min, max] inclusive — the renderer rolls
 *     against them via rand()
 *   - keep horizonCountMul + midCountMul under ~16 each to avoid blowing
 *     the Pi 5 sprite budget at density=1.0 (16 × 14 sprites per cloud ≈
 *     220 sprites worst-case which is the ceiling we've validated)
 */

import type { WeatherType } from '$lib/types';

export interface CloudComposition {
	id: string;
	/** Weather types this composition is allowed to play under. */
	weatherCompat: readonly WeatherType[];
	horizon: {
		/** Multiplier on effectiveDensity → cloud count for the horizon band. */
		countMul: number;
		/** Floor — at least N horizon clouds even at low density. */
		countMin: number;
		/** Screen-y band (% from top) where horizon clouds spawn. */
		yRange: [number, number];
		/** Per-cloud scale roll. */
		scaleRange: [number, number];
		/** Per-cloud horizontal drift speed (% per second). */
		speedRange: [number, number];
		/** Sprites per cloud (PNGs stacked inside one cloud base). */
		spritesPerCloud: [number, number];
	};
	mid: {
		countMul: number;
		countMin: number;
		yRange: [number, number];
		scaleRange: [number, number];
		speedRange: [number, number];
		spritesPerCloud: [number, number];
	};
}

// Phase 11 (user direction "the previous cloud logic was great, I wanted MORE
// in perspective"): restored wide y-bands across both layers so high-sky
// distant clouds (y 6-22, the original pre-Phase-10b range) coexist with the
// horizon-line band (y 28-44). Three perceptual depths now read in every
// composition: high sky, horizon line, foreground. Count multipliers bumped
// across the board so density actually fills the perspective gradient.
const COMPOSITIONS: readonly CloudComposition[] = [
	// Default scattered — restored to the previous full-range behaviour, with
	// MORE clouds for richer perspective. Horizon spans high sky AND the
	// visible horizon line; mid spans the foreground band below.
	{
		id: 'scattered',
		weatherCompat: ['clear', 'cloudy'],
		horizon: { countMul: 16, countMin: 8, yRange: [6, 44],  scaleRange: [1.6, 3.6], speedRange: [0.4, 1.8], spritesPerCloud: [10, 16] },
		mid:     { countMul: 14, countMin: 6, yRange: [25, 82], scaleRange: [0.7, 1.6], speedRange: [2.0, 7.0], spritesPerCloud: [8, 14] },
	},
	// Mackerel — many small puffs across the full sky range, sparse mid.
	{
		id: 'mackerel',
		weatherCompat: ['clear', 'cloudy'],
		horizon: { countMul: 22, countMin: 12, yRange: [6, 42], scaleRange: [1.0, 2.2], speedRange: [0.5, 1.6], spritesPerCloud: [5, 8] },
		mid:     { countMul: 6,  countMin: 3,  yRange: [40, 65], scaleRange: [0.5, 0.9], speedRange: [3.0, 6.0], spritesPerCloud: [4, 7] },
	},
	// Solitary giants — few large clouds, but spread across all depths.
	{
		id: 'solitary-giants',
		weatherCompat: ['clear'],
		horizon: { countMul: 8,  countMin: 4, yRange: [8, 42],  scaleRange: [2.8, 4.5], speedRange: [0.3, 1.2], spritesPerCloud: [14, 20] },
		mid:     { countMul: 5,  countMin: 3, yRange: [45, 78], scaleRange: [1.4, 2.4], speedRange: [1.5, 3.5], spritesPerCloud: [12, 16] },
	},
	// Wall — heavy bank, dense across all depths.
	{
		id: 'wall',
		weatherCompat: ['cloudy', 'rain', 'overcast'],
		horizon: { countMul: 22, countMin: 14, yRange: [6, 46], scaleRange: [2.0, 3.8], speedRange: [0.6, 2.0], spritesPerCloud: [12, 18] },
		mid:     { countMul: 18, countMin: 10, yRange: [28, 80], scaleRange: [1.0, 1.8], speedRange: [2.5, 5.5], spritesPerCloud: [10, 14] },
	},
	// Stratus deck — dense horizon-anchored band, lighter mid.
	{
		id: 'stratus-deck',
		weatherCompat: ['overcast', 'rain'],
		horizon: { countMul: 22, countMin: 16, yRange: [10, 48], scaleRange: [2.4, 4.0], speedRange: [0.4, 1.2], spritesPerCloud: [14, 18] },
		mid:     { countMul: 10, countMin: 6,  yRange: [48, 75], scaleRange: [1.2, 1.8], speedRange: [1.5, 3.0], spritesPerCloud: [10, 14] },
	},
	// Tower — vertical drama across all depths.
	{
		id: 'tower',
		weatherCompat: ['storm', 'rain'],
		horizon: { countMul: 18, countMin: 10, yRange: [6, 44],  scaleRange: [2.2, 3.6], speedRange: [0.5, 1.6], spritesPerCloud: [12, 16] },
		mid:     { countMul: 20, countMin: 12, yRange: [22, 80], scaleRange: [1.2, 2.8], speedRange: [2.0, 4.5], spritesPerCloud: [14, 20] },
	},
] as const;

export const CLOUD_COMPOSITIONS = COMPOSITIONS;

/**
 * Pick a cloud composition compatible with the given weather.
 *
 * Random across the filtered set — re-roll on every weather change. Falls
 * back to the first composition if no filter matches (defensive — every
 * WeatherType has at least one compat entry in COMPOSITIONS above).
 */
export function pickCloudComposition(weather: WeatherType): CloudComposition {
	const eligible = COMPOSITIONS.filter((c) => c.weatherCompat.includes(weather));
	const pool = eligible.length > 0 ? eligible : COMPOSITIONS;
	return pool[Math.floor(Math.random() * pool.length)];
}
