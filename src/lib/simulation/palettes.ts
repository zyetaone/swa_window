/**
 * Creative sky/light palettes — named presets that override the time-driven
 * `auto` palette with a single locked mood. Each preset exports the same
 * shape: `{ sky, horizon, fog, light, intensity }`.
 */

export interface Palette {
	sky: string;
	horizon: string;
	fog: string;
	light: string;
	intensity: number;
	water: { r: number; g: number; b: number };
	/** Short label shown in the palette bar. */
	label: string;
	/** Horizon color used as the swatch preview dot. */
	swatchColor: string;
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
		label: 'sunset',
		swatchColor: '#c05f40',
	},
	arctic: {
		sky: '#0a2438',
		horizon: '#b8dfee',
		fog: '#d8ecf3',
		light: '#ecf4fa',
		intensity: 0.75,
		water: { r: 140, g: 180, b: 200 },
		label: 'arctic',
		swatchColor: '#b8dfee',
	},
	neon: {
		sky: '#0a001e',
		horizon: '#ff2d8f',
		fog: '#8a1e7a',
		light: '#ffcc30',
		intensity: 0.6,
		water: { r: 40, g: 0, b: 100 },
		label: 'neon',
		swatchColor: '#ff2d8f',
	},
	noir: {
		sky: '#050505',
		horizon: '#2a2a2a',
		fog: '#1a1a1a',
		light: '#d8d4d0',
		intensity: 0.45,
		water: { r: 15, g: 15, b: 20 },
		label: 'noir',
		swatchColor: '#2a2a2a',
	},
	'southwest-warm': {
		sky: '#13243c',
		horizon: '#ecb156',
		fog: '#c0885b',
		light: '#fde1b0',
		intensity: 0.7,
		water: { r: 40, g: 90, b: 120 },
		label: 'southwest',
		swatchColor: '#ecb156',
	},
};

/** Palette bar entries — 'auto' is synthesized, not in PALETTES. */
export interface PaletteEntry {
	name: PaletteName;
	label: string;
	swatchColor: string;
}

export const PALETTE_ENTRIES: readonly PaletteEntry[] = [
	{ name: 'auto',       label: 'auto',       swatchColor: 'linear-gradient(135deg, #4a7ab5 0%, #e8805a 50%, #1a4a7a 100%)' },
	{ name: 'sunset',    label: 'sunset',    swatchColor: PALETTES.sunset.swatchColor },
	{ name: 'arctic',    label: 'arctic',    swatchColor: PALETTES.arctic.swatchColor },
	{ name: 'neon',      label: 'neon',      swatchColor: PALETTES.neon.swatchColor },
	{ name: 'noir',      label: 'noir',      swatchColor: PALETTES.noir.swatchColor },
	{ name: 'southwest-warm', label: 'southwest', swatchColor: PALETTES['southwest-warm'].swatchColor },
];

export const PALETTE_NAMES: readonly PaletteName[] = ['auto', 'sunset', 'arctic', 'neon', 'noir', 'southwest-warm'];
