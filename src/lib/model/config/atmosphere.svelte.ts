/**
 * AtmosphereConfig — what sits between the camera and the world.
 *
 * SSOT: defaults pull from AMBIENT + MICRO_EVENTS + AIRCRAFT (lightning) in
 * constants.ts. `$state` wraps them so admin push can mutate at runtime.
 */

import type { WeatherType } from '$lib/types';
import { AIRCRAFT, AMBIENT, MICRO_EVENTS, WEATHER_EFFECTS } from '$lib/constants';

export class CloudsConfig {
	density    = $state(AMBIENT.CLOUD_DENSITY_MAX * 0.85);
	speed      = $state(AMBIENT.CLOUD_SPEED_MIN + 0.4);
	layerCount = $state(3);
}

export class HazeConfig {
	amount = $state(AMBIENT.HAZE_MIN + 0.07);
	min: number    = $state(AMBIENT.HAZE_MIN);
	max: number    = $state(AMBIENT.HAZE_MAX);
}

export class WeatherConfig {
	// Default weather matches WEATHER_EFFECTS default key we expect on boot.
	current = $state<WeatherType>('cloudy');

	// Per-weather tuning — syncFromEffects(WEATHER_EFFECTS[current]) populates.
	// Defaults mirror WEATHER_EFFECTS.cloudy so initial render doesn't flicker.
	turbulence        = $state<'light' | 'moderate' | 'severe'>(WEATHER_EFFECTS.cloudy.turbulence);
	hasLightning      = $state(WEATHER_EFFECTS.cloudy.hasLightning);
	rainOpacity       = $state(WEATHER_EFFECTS.cloudy.rainOpacity);
	windAngle         = $state(WEATHER_EFFECTS.cloudy.windAngle);
	cloudDensityRange = $state<[number, number]>([...WEATHER_EFFECTS.cloudy.cloudDensityRange]);
	nightCloudFloor   = $state(WEATHER_EFFECTS.cloudy.nightCloudFloor);
	filterBrightness  = $state(WEATHER_EFFECTS.cloudy.filterBrightness);

	frostStartAltitude: number   = $state(AIRCRAFT.FROST_START_ALTITUDE);
	frostMaxAltitude: number     = $state(AIRCRAFT.FROST_MAX_ALTITUDE);
	lightningMinInterval: number = $state(AIRCRAFT.LIGHTNING_MIN_INTERVAL);
	lightningMaxInterval: number = $state(AIRCRAFT.LIGHTNING_MAX_INTERVAL);
	lightningDecayRate: number   = $state(AIRCRAFT.LIGHTNING_DECAY_RATE);

	/**
	 * Populate per-weather metadata from WEATHER_EFFECTS when weather changes.
	 * Call this from WindowModel whenever model.weather transitions.
	 */
	syncFromEffects(fx: { turbulence: 'light' | 'moderate' | 'severe'; hasLightning: boolean; rainOpacity: number; windAngle: number; cloudDensityRange: [number, number]; nightCloudFloor: number; filterBrightness: number }): void {
		this.turbulence       = fx.turbulence;
		this.hasLightning     = fx.hasLightning;
		this.rainOpacity      = fx.rainOpacity;
		this.windAngle        = fx.windAngle;
		this.cloudDensityRange = fx.cloudDensityRange;
		this.nightCloudFloor  = fx.nightCloudFloor;
		this.filterBrightness = fx.filterBrightness;
	}
}

export class MicroEventsConfig {
	minInterval: number          = $state(MICRO_EVENTS.MIN_INTERVAL);
	maxInterval: number          = $state(MICRO_EVENTS.MAX_INTERVAL);
	shootingStarDuration: number = $state(MICRO_EVENTS.SHOOTING_STAR_DURATION);
	birdDuration: number         = $state(MICRO_EVENTS.BIRD_DURATION);
	contrailDuration: number     = $state(MICRO_EVENTS.CONTRAIL_DURATION);
}

export class AtmosphereConfig {
	clouds      = new CloudsConfig();
	haze        = new HazeConfig();
	weather     = new WeatherConfig();
	microEvents = new MicroEventsConfig();

	setPath(path: string, value: unknown): boolean {
		const [head, ...rest] = path.split('.');
		switch (head) {
			case 'clouds':
				switch (rest.join('.')) {
					case 'density':    this.clouds.density    = value as number; return true;
					case 'speed':      this.clouds.speed      = value as number; return true;
					case 'layerCount': this.clouds.layerCount = value as number; return true;
				}
				return false;
			case 'haze':
				switch (rest.join('.')) {
					case 'amount': this.haze.amount = value as number; return true;
					case 'min':    this.haze.min    = value as number; return true;
					case 'max':    this.haze.max    = value as number; return true;
				}
				return false;
			case 'weather':
				switch (rest.join('.')) {
					case 'current':              this.weather.current              = value as WeatherType; return true;
					case 'turbulence':          this.weather.turbulence           = value as 'light' | 'moderate' | 'severe'; return true;
					case 'hasLightning':         this.weather.hasLightning         = value as boolean; return true;
					case 'rainOpacity':         this.weather.rainOpacity          = value as number; return true;
					case 'windAngle':           this.weather.windAngle            = value as number; return true;
					case 'nightCloudFloor':     this.weather.nightCloudFloor      = value as number; return true;
					case 'filterBrightness':    this.weather.filterBrightness    = value as number; return true;
					case 'frostStartAltitude':   this.weather.frostStartAltitude   = value as number;      return true;
					case 'frostMaxAltitude':     this.weather.frostMaxAltitude     = value as number;      return true;
					case 'lightningMinInterval': this.weather.lightningMinInterval = value as number;      return true;
					case 'lightningMaxInterval': this.weather.lightningMaxInterval = value as number;      return true;
					case 'lightningDecayRate':   this.weather.lightningDecayRate   = value as number;      return true;
				}
				return false;
			case 'microEvents':
				switch (rest.join('.')) {
					case 'minInterval':          this.microEvents.minInterval          = value as number; return true;
					case 'maxInterval':          this.microEvents.maxInterval          = value as number; return true;
					case 'shootingStarDuration': this.microEvents.shootingStarDuration = value as number; return true;
					case 'birdDuration':         this.microEvents.birdDuration         = value as number; return true;
					case 'contrailDuration':     this.microEvents.contrailDuration     = value as number; return true;
				}
				return false;
		}
		return false;
	}

	toJSON() {
		return {
			clouds:      { density: this.clouds.density, speed: this.clouds.speed, layerCount: this.clouds.layerCount },
			haze:        { amount: this.haze.amount, min: this.haze.min, max: this.haze.max },
			weather:     {
				current: this.weather.current,
				turbulence: this.weather.turbulence,
				hasLightning: this.weather.hasLightning,
				rainOpacity: this.weather.rainOpacity,
				windAngle: this.weather.windAngle,
				cloudDensityRange: this.weather.cloudDensityRange,
				nightCloudFloor: this.weather.nightCloudFloor,
				filterBrightness: this.weather.filterBrightness,
				frostStartAltitude: this.weather.frostStartAltitude,
				frostMaxAltitude: this.weather.frostMaxAltitude,
				lightningMinInterval: this.weather.lightningMinInterval,
				lightningMaxInterval: this.weather.lightningMaxInterval,
				lightningDecayRate: this.weather.lightningDecayRate,
			},
			microEvents: {
				minInterval: this.microEvents.minInterval,
				maxInterval: this.microEvents.maxInterval,
				shootingStarDuration: this.microEvents.shootingStarDuration,
				birdDuration: this.microEvents.birdDuration,
				contrailDuration: this.microEvents.contrailDuration,
			},
		};
	}
}
