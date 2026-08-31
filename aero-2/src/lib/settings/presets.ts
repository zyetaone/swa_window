/**
 * Scene Composition Presets for Aero Dynamic Window.
 * Curated visual, atmospheric, lighting, terrain, and audio moods.
 */

import type { Weather } from '../display/flight/view.js';

export interface ScenePreset {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: string;
	readonly badge: string;
	readonly config: {
		placeId?: string;
		/**
		 * Local hour to compose the scene at, 0-24.
		 *
		 * NOT `clockOffsetH`. That field is a delta from real local time, so the
		 * six presets below — authored as `clockOffsetH: 12.0, // midnight` —
		 * were midnight only when the real local hour happened to be noon, and
		 * drifted hour by hour on a kiosk that runs all day. Every card's
		 * lighting claim held by coincidence. `applyPreset` converts this to the
		 * offset the camera actually takes.
		 */
		localHour?: number;
		cloudDensity?: number;
		cloudOpacity?: number;
		cloudSpeed?: number;
		cloudAltitudeM?: number;
		exaggeration?: number;
		shade?: number;
		weather?: Weather;
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
			localHour: 18.25, // low amber sun, just before the horizon
			cloudDensity: 0.35,
			cloudOpacity: 0.65,
			cloudSpeed: 0.8,
			cloudAltitudeM: 4500,
			exaggeration: 1.2,
			shade: 0.65,
			weather: 'clear',
			pitchDeg: -12,
			azimuthDeg: 5,
			speed: 3.5,
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
			localHour: 8.5, // crisp morning light, long shadows down the ridges
			cloudDensity: 0.2,
			cloudOpacity: 0.5,
			cloudSpeed: 0.5,
			cloudAltitudeM: 6000,
			exaggeration: 2.4,
			shade: 0.9,
			weather: 'clear',
			pitchDeg: -22,
			azimuthDeg: -10,
			speed: 4.0,
			audioEnabled: true,
			audioVolume: 0.5
		}
	},
	{
		id: 'gulf-midnight',
		name: 'Dubai Midnight',
		description:
			'The Gulf coast after dark — VIIRS night-light radiance seen through rain on the glass.',
		icon: '🌃',
		badge: 'Night & Rain',
		config: {
			placeId: 'dubai',
			localHour: 0.5, // full dark, VIIRS radiance at its most legible
			cloudDensity: 0.5,
			cloudOpacity: 0.7,
			cloudSpeed: 1.2,
			cloudAltitudeM: 3000,
			exaggeration: 1.0,
			shade: 0.4,
			weather: 'rain',
			pitchDeg: -18,
			azimuthDeg: 0,
			speed: 3.0,
			audioEnabled: true,
			audioVolume: 0.4
		}
	},
	{
		id: 'pacific-glide',
		name: 'Pacific Noon Glide',
		description:
			'Open Pacific under a direct midday sun. No coastline, no skyline — water and light.',
		icon: '🏝️',
		badge: 'Vibrant',
		config: {
			placeId: 'ocean',
			localHour: 12.0, // direct overhead sun on open water
			cloudDensity: 0.4,
			cloudOpacity: 0.6,
			cloudSpeed: 1.0,
			cloudAltitudeM: 3500,
			exaggeration: 1.5,
			shade: 0.5,
			weather: 'clear',
			pitchDeg: -15,
			azimuthDeg: 15,
			speed: 4.5,
			audioEnabled: true,
			audioVolume: 0.5
		}
	},
	{
		id: 'jetstream-cruising',
		name: 'Front Range Cruise',
		description: 'High afternoon above the Front Range, riding the top of an 8,500 m cloud deck.',
		icon: '✈️',
		badge: 'Cruising',
		config: {
			placeId: 'denver',
			localHour: 15.0, // high afternoon above the cloud deck
			cloudDensity: 0.6,
			cloudOpacity: 0.8,
			cloudSpeed: 2.0,
			cloudAltitudeM: 8500,
			exaggeration: 1.3,
			shade: 0.6,
			weather: 'cloudy',
			pitchDeg: -10,
			azimuthDeg: 0,
			speed: 6.0,
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
			localHour: 16.5, // flat grey light under the overcast
			cloudDensity: 0.9,
			cloudOpacity: 0.95,
			cloudSpeed: 3.0,
			cloudAltitudeM: 2000,
			exaggeration: 1.0,
			shade: 0.7,
			weather: 'storm',
			pitchDeg: -16,
			azimuthDeg: 0,
			speed: 5.0,
			audioEnabled: true,
			audioVolume: 0.7
		}
	}
];
