/**
 * DirectorConfig — when things change.
 *
 * SSOT: defaults pull from AMBIENT + AIRCRAFT in constants.ts.
 * `$state` wraps them so admin push can mutate at runtime.
 */

import type { WeatherType } from '$lib/types';
import { AIRCRAFT, AMBIENT } from '$lib/constants';

export class DaylightConfig {
	syncToRealTime  = $state(true);
	manualTimeOfDay = $state(12);
	syncIntervalMs: number  = $state(AIRCRAFT.REAL_TIME_SYNC_INTERVAL);
}

export class AutopilotConfig {
	enabled             = $state(true);
	initialMinDelay: number     = $state(AMBIENT.INITIAL_MIN_DELAY);
	initialMaxDelay: number     = $state(AMBIENT.INITIAL_MAX_DELAY);
	subsequentMinDelay: number  = $state(AMBIENT.SUBSEQUENT_MIN_DELAY);
	subsequentMaxDelay: number  = $state(AMBIENT.SUBSEQUENT_MAX_DELAY);
	weatherChangeChance: number = $state(AMBIENT.WEATHER_CHANGE_CHANCE);
	weatherPool         = $state<readonly WeatherType[]>([...AMBIENT.WEATHER_POOL]);
	directorMinInterval: number = $state(AMBIENT.DIRECTOR_MIN_INTERVAL);
	directorMaxInterval: number = $state(AMBIENT.DIRECTOR_MAX_INTERVAL);
}

export class AmbientDriftConfig {
	cloudDensityShift: number = $state(AMBIENT.CLOUD_DENSITY_SHIFT);
	cloudDensityMin: number   = $state(AMBIENT.CLOUD_DENSITY_MIN);
	cloudDensityMax: number   = $state(AMBIENT.CLOUD_DENSITY_MAX);
	cloudSpeedShift: number   = $state(AMBIENT.CLOUD_SPEED_SHIFT);
	cloudSpeedMin: number     = $state(AMBIENT.CLOUD_SPEED_MIN);
	cloudSpeedMax: number     = $state(AMBIENT.CLOUD_SPEED_MAX);
	hazeShift: number         = $state(AMBIENT.HAZE_SHIFT);
	hazeMin: number           = $state(AMBIENT.HAZE_MIN);
	hazeMax: number           = $state(AMBIENT.HAZE_MAX);
}

export class DirectorConfig {
	daylight  = new DaylightConfig();
	autopilot = new AutopilotConfig();
	ambient   = new AmbientDriftConfig();

	setPath(path: string, value: unknown): boolean {
		const [head, sub] = path.split('.');
		switch (head) {
			case 'daylight':
				switch (sub) {
					case 'syncToRealTime':  this.daylight.syncToRealTime  = value as boolean; return true;
					case 'manualTimeOfDay': this.daylight.manualTimeOfDay = value as number;  return true;
					case 'syncIntervalMs':  this.daylight.syncIntervalMs  = value as number;  return true;
				}
				return false;
			case 'autopilot':
				switch (sub) {
					case 'enabled':             this.autopilot.enabled             = value as boolean; return true;
					case 'initialMinDelay':     this.autopilot.initialMinDelay     = value as number;  return true;
					case 'initialMaxDelay':     this.autopilot.initialMaxDelay     = value as number;  return true;
					case 'subsequentMinDelay':  this.autopilot.subsequentMinDelay  = value as number;  return true;
					case 'subsequentMaxDelay':  this.autopilot.subsequentMaxDelay  = value as number;  return true;
					case 'weatherChangeChance': this.autopilot.weatherChangeChance = value as number;  return true;
					case 'weatherPool':         this.autopilot.weatherPool         = value as WeatherType[]; return true;
					case 'directorMinInterval': this.autopilot.directorMinInterval = value as number;  return true;
					case 'directorMaxInterval': this.autopilot.directorMaxInterval = value as number;  return true;
				}
				return false;
			case 'ambient':
				switch (sub) {
					case 'cloudDensityShift': this.ambient.cloudDensityShift = value as number; return true;
					case 'cloudDensityMin':   this.ambient.cloudDensityMin   = value as number; return true;
					case 'cloudDensityMax':   this.ambient.cloudDensityMax   = value as number; return true;
					case 'cloudSpeedShift':   this.ambient.cloudSpeedShift   = value as number; return true;
					case 'cloudSpeedMin':     this.ambient.cloudSpeedMin     = value as number; return true;
					case 'cloudSpeedMax':     this.ambient.cloudSpeedMax     = value as number; return true;
					case 'hazeShift':         this.ambient.hazeShift         = value as number; return true;
					case 'hazeMin':           this.ambient.hazeMin           = value as number; return true;
					case 'hazeMax':           this.ambient.hazeMax           = value as number; return true;
				}
				return false;
		}
		return false;
	}

	toJSON() {
		return {
			daylight: {
				syncToRealTime: this.daylight.syncToRealTime,
				manualTimeOfDay: this.daylight.manualTimeOfDay,
				syncIntervalMs: this.daylight.syncIntervalMs,
			},
			autopilot: {
				enabled: this.autopilot.enabled,
				initialMinDelay: this.autopilot.initialMinDelay,
				initialMaxDelay: this.autopilot.initialMaxDelay,
				subsequentMinDelay: this.autopilot.subsequentMinDelay,
				subsequentMaxDelay: this.autopilot.subsequentMaxDelay,
				weatherChangeChance: this.autopilot.weatherChangeChance,
				weatherPool: [...this.autopilot.weatherPool],
				directorMinInterval: this.autopilot.directorMinInterval,
				directorMaxInterval: this.autopilot.directorMaxInterval,
			},
			ambient: {
				cloudDensityShift: this.ambient.cloudDensityShift,
				cloudDensityMin: this.ambient.cloudDensityMin,
				cloudDensityMax: this.ambient.cloudDensityMax,
				cloudSpeedShift: this.ambient.cloudSpeedShift,
				cloudSpeedMin: this.ambient.cloudSpeedMin,
				cloudSpeedMax: this.ambient.cloudSpeedMax,
				hazeShift: this.ambient.hazeShift,
				hazeMin: this.ambient.hazeMin,
				hazeMax: this.ambient.hazeMax,
			},
		};
	}
}
