/**
 * Scene Composition Presets for Aero Dynamic Window.
 * Curated visual, atmospheric, lighting, terrain, and audio moods.
 */

import { LOCATIONS } from './locations.js';

export interface ScenePreset {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	readonly badge: string;
	readonly config: {
		placeId?: string;
		engine?: 'cesium' | 'maplibre';
		clockOffsetH?: number;
		cloudDensity?: number;
		cloudOpacity?: number;
		cloudSpeed?: number;
		cloudAltitudeM?: number;
		exaggeration?: number;
		shade?: number;
		rain?: boolean;
		cesiumLighting?: boolean;
		cesiumAtmosphere?: boolean;
		cesiumViirsBrightness?: number;
		audioEnabled?: boolean;
		audioVolume?: number;
		pitchDeg?: number;
		azimuthDeg?: number;
		speed?: number;
		wingVisible?: boolean;
	};
}

export const SCENE_PRESETS: readonly ScenePreset[] = [
	{
		id: 'golden-hour',
		name: 'Golden Hour Cruise',
		description: 'Warm sunset amber illumination with soft cirrus clouds and horizon vista.',
		icon: '🌅',
		badge: 'Cinematic',
		config: {
			placeId: 'las_vegas',
			clockOffsetH: 6.5, // late afternoon sunset
			cloudDensity: 0.35,
			cloudOpacity: 0.65,
			cloudSpeed: 0.8,
			cloudAltitudeM: 4500,
			exaggeration: 1.2,
			shade: 0.65,
			rain: false,
			pitchDeg: -12,
			azimuthDeg: 5,
			speed: 3.5,
			cesiumLighting: true,
			audioEnabled: true,
			audioVolume: 0.45
		}
	},
	{
		id: 'alpine-ridge',
		name: 'Alpine Mountain Ridge',
		description: 'Dramatic 3D mountain relief with Igor hillshading over snow-capped peaks.',
		icon: '🏔️',
		badge: 'High Relief',
		config: {
			placeId: 'himalayas',
			clockOffsetH: 2.0, // crisp morning light
			cloudDensity: 0.2,
			cloudOpacity: 0.5,
			cloudSpeed: 0.5,
			cloudAltitudeM: 6000,
			exaggeration: 2.4,
			shade: 0.9,
			rain: false,
			pitchDeg: -22,
			azimuthDeg: -10,
			speed: 4.0,
			cesiumLighting: true,
			audioEnabled: true,
			audioVolume: 0.5
		}
	},
	{
		id: 'tokyo-midnight',
		name: 'Neon Metropolis Midnight',
		description: 'Midnight cityscape with luminous VIIRS night-light radiance and rainy glass.',
		icon: '🌃',
		badge: 'Night & Rain',
		config: {
			placeId: 'dubai',
			clockOffsetH: 12.0, // midnight darkness
			cloudDensity: 0.5,
			cloudOpacity: 0.7,
			cloudSpeed: 1.2,
			cloudAltitudeM: 3000,
			exaggeration: 1.0,
			shade: 0.4,
			rain: true,
			pitchDeg: -18,
			azimuthDeg: 0,
			speed: 3.0,
			cesiumLighting: true,
			cesiumViirsBrightness: 3.5,
			audioEnabled: true,
			audioVolume: 0.4
		}
	},
	{
		id: 'tropical-glide',
		name: 'Tropical Coast Glide',
		description: 'Vibrant oceanic coastlines under clear midday equatorial sun.',
		icon: '🏝️',
		badge: 'Vibrant',
		config: {
			placeId: 'ocean',
			clockOffsetH: 0.0, // direct midday sun
			cloudDensity: 0.4,
			cloudOpacity: 0.6,
			cloudSpeed: 1.0,
			cloudAltitudeM: 3500,
			exaggeration: 1.5,
			shade: 0.5,
			rain: false,
			pitchDeg: -15,
			azimuthDeg: 15,
			speed: 4.5,
			cesiumLighting: true,
			audioEnabled: true,
			audioVolume: 0.5
		}
	},
	{
		id: 'jetstream-cruising',
		name: 'High Altitude Jetstream',
		description: 'Smooth FL350 long-haul cruising above vast cloudscapes and continental horizon.',
		icon: '✈️',
		badge: 'Cruising',
		config: {
			placeId: 'denver',
			clockOffsetH: 3.0,
			cloudDensity: 0.6,
			cloudOpacity: 0.8,
			cloudSpeed: 2.0,
			cloudAltitudeM: 8500,
			exaggeration: 1.3,
			shade: 0.6,
			rain: false,
			pitchDeg: -10,
			azimuthDeg: 0,
			speed: 6.0,
			cesiumLighting: true,
			audioEnabled: true,
			audioVolume: 0.6
		}
	},
	{
		id: 'storm-transit',
		name: 'Stormy Overcast Transit',
		description: 'Heavy atmospheric overcast with turbulent cloud density and rain condensation.',
		icon: '⛈️',
		badge: 'Storm',
		config: {
			placeId: 'chicago_midway',
			clockOffsetH: 4.0,
			cloudDensity: 0.9,
			cloudOpacity: 0.95,
			cloudSpeed: 3.0,
			cloudAltitudeM: 2000,
			exaggeration: 1.0,
			shade: 0.7,
			rain: true,
			pitchDeg: -16,
			azimuthDeg: 0,
			speed: 5.0,
			cesiumLighting: true,
			audioEnabled: true,
			audioVolume: 0.7
		}
	}
];
