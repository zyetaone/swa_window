/**
 * Creative sky/light palettes — named presets that override the time-driven
 * `auto` palette with a single locked mood. Each preset exports the same
 * shape as the time-driven band: `{ sky, horizon, fog, light, intensity }`.
 *
 * The preset also suggests a water color band (golden / navy / neon) that
 * MapLibreGlobe reads for the water-fill layer.
 */

export interface Palette {
	sky: string;
	horizon: string;
	fog: string;
	light: string;
	intensity: number;
	water: { r: number; g: number; b: number };
}

export type PaletteName =
	| 'auto'
	| 'sunset'
	| 'arctic'
	| 'neon'
	| 'noir'
	| 'southwest-warm';

/** Named creative presets. Use 'auto' for time-driven (default). */
export const PALETTES: Record<Exclude<PaletteName, 'auto'>, Palette> = {
	sunset: {
		sky: '#1e1a40',
		horizon: '#c05f40',
		fog: '#8a4a40',
		light: '#ff9050',
		intensity: 0.55,
		water: { r: 130, g: 75, b: 50 },
	},
	arctic: {
		sky: '#0a2438',
		horizon: '#b8dfee',
		fog: '#d8ecf3',
		light: '#ecf4fa',
		intensity: 0.75,
		water: { r: 140, g: 180, b: 200 },
	},
	neon: {
		sky: '#0a001e',
		horizon: '#ff2d8f',
		fog: '#8a1e7a',
		light: '#ffcc30',
		intensity: 0.6,
		water: { r: 40, g: 0, b: 100 },
	},
	noir: {
		sky: '#050505',
		horizon: '#2a2a2a',
		fog: '#1a1a1a',
		light: '#d8d4d0',
		intensity: 0.45,
		water: { r: 15, g: 15, b: 20 },
	},
	'southwest-warm': {
		// Southwest's brand: warm oranges, deep navy, cream highlights.
		sky: '#13243c',
		horizon: '#ecb156',
		fog: '#c0885b',
		light: '#fde1b0',
		intensity: 0.7,
		water: { r: 40, g: 90, b: 120 },
	},
};

export const PALETTE_NAMES: readonly PaletteName[] = ['auto', 'sunset', 'arctic', 'neon', 'noir', 'southwest-warm'];
