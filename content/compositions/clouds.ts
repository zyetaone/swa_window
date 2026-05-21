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

const COMPOSITIONS: readonly CloudComposition[] = [
	// Default scattered — historical behaviour: balanced bands, medium count.
	{
		id: 'scattered',
		weatherCompat: ['clear', 'cloudy'],
		horizon: { countMul: 8, countMin: 4, yRange: [28, 44], scaleRange: [2.0, 3.6], speedRange: [0.4, 1.6], spritesPerCloud: [10, 16] },
		mid:     { countMul: 8, countMin: 3, yRange: [25, 82], scaleRange: [0.7, 1.5], speedRange: [2.0, 7.0], spritesPerCloud: [8, 14] },
	},
	// Mackerel — many small puffs high in the sky, sparse mid.
	{
		id: 'mackerel',
		weatherCompat: ['clear', 'cloudy'],
		horizon: { countMul: 14, countMin: 8, yRange: [22, 38], scaleRange: [1.2, 2.2], speedRange: [0.5, 1.4], spritesPerCloud: [5, 8] },
		mid:     { countMul: 4,  countMin: 2, yRange: [40, 60], scaleRange: [0.5, 0.9], speedRange: [3.0, 6.0], spritesPerCloud: [4, 7] },
	},
	// Solitary giants — few large clouds, low, dramatic shadows.
	{
		id: 'solitary-giants',
		weatherCompat: ['clear'],
		horizon: { countMul: 4, countMin: 2, yRange: [30, 42], scaleRange: [3.2, 4.5], speedRange: [0.3, 0.9], spritesPerCloud: [14, 20] },
		mid:     { countMul: 3, countMin: 2, yRange: [45, 78], scaleRange: [1.6, 2.4], speedRange: [1.5, 3.5], spritesPerCloud: [12, 16] },
	},
	// Wall — heavy bank, denser one side. The compositor picks side via x-bias
	// at render time (left/right band roll), but the density itself is huge.
	{
		id: 'wall',
		weatherCompat: ['cloudy', 'rain', 'overcast'],
		horizon: { countMul: 16, countMin: 10, yRange: [26, 46], scaleRange: [2.4, 3.8], speedRange: [0.6, 1.8], spritesPerCloud: [12, 18] },
		mid:     { countMul: 12, countMin: 6,  yRange: [30, 75], scaleRange: [1.0, 1.8], speedRange: [2.5, 5.5], spritesPerCloud: [10, 14] },
	},
	// Stratus deck — uniform horizon band, no scattered mid. Overcast feel.
	{
		id: 'stratus-deck',
		weatherCompat: ['overcast', 'rain'],
		horizon: { countMul: 16, countMin: 12, yRange: [32, 48], scaleRange: [2.8, 4.0], speedRange: [0.4, 1.0], spritesPerCloud: [14, 18] },
		mid:     { countMul: 6,  countMin: 4,  yRange: [50, 70], scaleRange: [1.2, 1.8], speedRange: [1.5, 3.0], spritesPerCloud: [10, 14] },
	},
	// Tower — one cumulonimbus tower dominates mid, scattered around.
	{
		id: 'tower',
		weatherCompat: ['storm', 'rain'],
		horizon: { countMul: 12, countMin: 8, yRange: [28, 44], scaleRange: [2.6, 3.6], speedRange: [0.5, 1.4], spritesPerCloud: [12, 16] },
		mid:     { countMul: 16, countMin: 8, yRange: [25, 80], scaleRange: [1.4, 2.8], speedRange: [2.0, 4.0], spritesPerCloud: [14, 20] },
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
