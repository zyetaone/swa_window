/**
 * Weather recipes — authored content.
 *
 * One entry per WeatherType. Drives turbulence level, cloud density ranges,
 * rain opacity, lightning presence, and the CSS filter brightness applied
 * to scene visuals.
 *
 * Edit here to tune the FEEL of each weather state. Non-engineer-curator
 * friendly — no engine logic lives in this file.
 */

import type { WeatherType } from '$lib/types';

export interface WeatherEffect {
	turbulence: 'light' | 'moderate' | 'severe';
	hasLightning: boolean;
	cloudDensityRange: [min: number, max: number];
	nightCloudFloor: number;
	rainOpacity: number;
	windAngle: number;
	filterBrightness: number;
}

export const WEATHER_EFFECTS: Record<WeatherType, WeatherEffect> = {
	clear: {
		turbulence: 'light',
		hasLightning: false,
		cloudDensityRange: [0, 0.3],
		nightCloudFloor: 0,
		rainOpacity: 0,
		windAngle: 88,
		filterBrightness: 1.0,
	},
	cloudy: {
		turbulence: 'light',
		hasLightning: false,
		cloudDensityRange: [0.7, 1],
		nightCloudFloor: 0,
		rainOpacity: 0,
		windAngle: 87,
		filterBrightness: 1.0,
	},
	rain: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.8, 1],
		nightCloudFloor: 0.3,
		rainOpacity: 0.25,
		windAngle: 86,
		filterBrightness: 0.95,
	},
	overcast: {
		turbulence: 'moderate',
		hasLightning: false,
		cloudDensityRange: [0.92, 1],
		nightCloudFloor: 0.5,
		rainOpacity: 0.18,
		windAngle: 86,
		filterBrightness: 0.9,
	},
	storm: {
		turbulence: 'severe',
		hasLightning: true,
		cloudDensityRange: [0.98, 1],
		nightCloudFloor: 0.7,
		rainOpacity: 0.35,
		windAngle: 84,
		filterBrightness: 0.85,
	},
};
