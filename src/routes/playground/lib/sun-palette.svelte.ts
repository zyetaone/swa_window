import { PALETTES, type PaletteName } from '../palettes';

export type Band = {
	sky: string;
	horizon: string;
	fog: string;
	light: string;
	intensity: number;
	water: { r: number; g: number; b: number };
};

export function getSunParams(timeOfDay: number) {
	const sunAzimuth = (timeOfDay * 15) % 360;
	const hourAngle = (timeOfDay - 12) * 15;
	const elevation = Math.cos(hourAngle * Math.PI / 180);
	const sunPolar = 90 - elevation * 60;
	return { polar: sunPolar, azimuth: sunAzimuth, elevation };
}

export const BANDS: [number, number, Band][] = [
	[5, 7, { sky: '#2a1f4a', horizon: '#e8805a', fog: '#d8b898', light: '#ffd4b8', intensity: 0.55, water: { r: 70, g: 50, b: 90 } }],
	// Morning + Day: fog pushed to cloud-white so horizon reads as a cloud band
	[7, 10, { sky: '#4a7ab5', horizon: '#e0ecf5', fog: '#eaf0f6', light: '#fff1d6', intensity: 0.7, water: { r: 50, g: 92, b: 130 } }],
	[10, 16, { sky: '#1a4a80', horizon: '#e2eaf4', fog: '#e8eef5', light: '#fffef2', intensity: 0.8, water: { r: 32, g: 74, b: 96 } }],
	[16, 18, { sky: '#2c3e75', horizon: '#d4895a', fog: '#c68860', light: '#ffc080', intensity: 0.65, water: { r: 100, g: 90, b: 90 } }],
	[18, 20, { sky: '#1e1a40', horizon: '#c05f40', fog: '#8a4a40', light: '#ff9050', intensity: 0.5, water: { r: 130, g: 75, b: 50 } }],
	[20, 22, { sky: '#0a0f28', horizon: '#301838', fog: '#1a1432', light: '#7a88d0', intensity: 0.28, water: { r: 10, g: 18, b: 35 } }],
];

export const NIGHT_BAND: Band = { sky: '#050510', horizon: '#0a1028', fog: '#0a0f20', light: '#a8b4d0', intensity: 0.2, water: { r: 4, g: 14, b: 24 } };

export function getSkyPalette(timeOfDay: number, paletteName: PaletteName): Band {
	if (paletteName !== 'auto' && PALETTES[paletteName]) return PALETTES[paletteName];
	const h = timeOfDay;
	for (const [lo, hi, band] of BANDS) {
		if (h >= lo && h < hi) return band;
	}
	return NIGHT_BAND;
}
