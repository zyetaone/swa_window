import { type LocationId, type WeatherType } from '$lib/types';
import { LOCATIONS } from '$lib/locations';
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
	autoFly = $state(true); 
	kioskMode = $state(true); // auto-cycle locations
	
	// Orbital mechanics
	orbitAngle = $state(Math.random() * Math.PI * 2);
	orbitAngularSpeed = $state(0.07);
	nextLocationChange = $state(0);
	pitchBias = $state(0);

	// Creative
	paletteName = $state<PaletteName>('auto');
	freeCam = $state(false);

	// Tunables
	lodMaxZoomLevels = $state(6);
	lodTileCountRatio = $state(2.0);

	constructor() {
		if (typeof window !== 'undefined') {
			this.nextLocationChange = performance.now() + 120_000 + Math.random() * 120_000;
			this.heading = Math.floor(Math.random() * 360);
		}
	}

	tick(dt: number, now: number) {
		if (this.autoTime) {
			this.timeOfDay = (this.timeOfDay + dt * 0.5) % 24;
		}

		if (this.autoFly) {
			// Kiosk auto-rotation
			if (this.kioskMode && now > this.nextLocationChange) {
				this.cycleLocation(now);
			}

			// Altitude drift
			const altOsc = Math.sin(now * 0.00006) * 2000;
			this.altitude = Math.max(20_000, Math.min(45_000, this.altitude + altOsc * dt * 0.3));

			// Orbital progress
			this.orbitAngle += dt * this.orbitAngularSpeed * this.planeSpeed;
			this.heading = ((this.orbitAngle * 180 / Math.PI) + 90) % 360;
		} else if (this.autoOrbit) {
			this.heading = (this.heading + dt * 5 * this.planeSpeed) % 360;
		}
	}

	cycleLocation(now?: number) {
		const ids = LOCATIONS.map(l => l.id);
		const idx = ids.indexOf(this.activeLocation);
		this.activeLocation = ids[(idx + 1) % ids.length];

		// New segment profile
		this.altitude = 20_000 + Math.floor(Math.random() * 25_000);
		this.pitchBias = (Math.random() - 0.5) * 12;
		const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'light', 'light', 'moderate', 'moderate', 'severe'];
		this.turbulenceLevel = turbs[Math.floor(Math.random() * turbs.length)];
		
		if (now) {
			this.nextLocationChange = now + 120_000 + Math.random() * 120_000;
		}
	}

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
		this.kioskMode = true;
		this.turbulenceLevel = 'light';
		this.pitchBias = 0;
	}

	randomize() {
		this.heading = Math.floor(Math.random() * 360);
		this.altitude = Math.floor(15000 + Math.random() * 30000);
		this.density = 0.3 + Math.random() * 0.6;
		this.cloudSpeed = 0.5 + Math.random() * 1.5;
		this.timeOfDay = Math.random() * 24;
		const turbs: ('light' | 'moderate' | 'severe')[] = ['light', 'moderate', 'severe'];
		this.turbulenceLevel = turbs[Math.floor(Math.random() * 3)];
		this.cycleLocation();
	}
}

export const pg = new PlaygroundState();
