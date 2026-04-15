import { type LocationId, type WeatherType } from '$lib/types';
import type { PaletteName } from '../palettes';

/**
 * PlaygroundState — Centralized Svelte 5 reactive configuration.
 * Groups all interactive controls, isolating the view layer from state logic.
 */
export class PlaygroundState {
	// Location
	activeLocation = $state<LocationId>('dubai');
	
	// Environment
	timeOfDay = $state(12);
	weather = $state<WeatherType>('clear');
	maplibreSource = $state<string>('eox-s2');

	// Rendering flags
	mlTerrain = $state(true);
	mlBuildings = $state(true);
	mlAtmosphere = $state(true);
	showCityLights = $state(true);
	showLandmarks = $state(true);
	showThreeBillboards = $state(false);
	useRealisticClouds = $state(true);

	// Cloud mechanics
	density = $state(0.6);
	cloudSpeed = $state(1.0);

	// Flight mechanics
	heading = $state(90);
	planeSpeed = $state(1.0);
	altitude = $state(30000);
	turbulenceLevel = $state<'light' | 'moderate' | 'severe'>('light');

	// Automations
	autoOrbit = $state(false);
	autoTime = $state(false);
	autoFly = $state(true);  // default ON — scene feels alive on first load
	
	// Creative
	paletteName = $state<PaletteName>('auto');
	freeCam = $state(false);

	// Tunables
	lodMaxZoomLevels = $state(6);
	lodTileCountRatio = $state(2.0);

	reset() {
		this.heading = 90;
		this.altitude = 30000;
		this.planeSpeed = 1.0;
		this.density = 0.6;
		this.cloudSpeed = 1.0;
		this.timeOfDay = 12;
		this.weather = 'clear';
		this.autoOrbit = false;
		this.autoTime = false;
		this.autoFly = true;
		this.turbulenceLevel = 'light';
	}

	randomize() {
		this.heading = Math.floor(Math.random() * 360);
		this.altitude = Math.floor(15000 + Math.random() * 30000);
		this.density = 0.3 + Math.random() * 0.6;
		this.cloudSpeed = 0.5 + Math.random() * 1.5;
		this.timeOfDay = Math.random() * 24;
		const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'moderate', 'severe'];
		this.turbulenceLevel = turbs[Math.floor(Math.random() * 3)];
	}
}

export const pg = new PlaygroundState();
