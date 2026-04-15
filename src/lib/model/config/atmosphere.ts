/**
 * AtmosphereConfig — what sits between the camera and the world.
 *
 * Covers: clouds (density/speed/layer geometry), haze, weather effects,
 * micro-event scheduling. Everything that visually overlays the map.
 */

import type { WeatherType } from '$lib/types';

export class CloudsConfig {
	density = $state(0.85);
	speed   = $state(0.6);
	/** Number of parallax decks (far / mid / near) — currently 3 in CloudBlobs. */
	layerCount = $state(3);
}

export class HazeConfig {
	/** Global haze scalar 0-0.2 — multiplies per-location intensity + altitude. */
	amount = $state(0.07);
	min    = $state(0);
	max    = $state(0.15);
}

export class WeatherConfig {
	current = $state<WeatherType>('cloudy');
	/** Frost visibility altitude thresholds (feet). */
	frostStartAltitude = $state(25_000);
	frostMaxAltitude   = $state(40_000);
	/** Lightning timing (seconds). */
	lightningMinInterval = $state(5);
	lightningMaxInterval = $state(30);
	lightningDecayRate   = $state(8);
}

export class MicroEventsConfig {
	/** Seconds between micro-event spawns. */
	minInterval = $state(100);
	maxInterval = $state(300);
	/** Per-event durations (seconds). */
	shootingStarDuration = $state(1.5);
	birdDuration         = $state(8);
	contrailDuration     = $state(12);
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
