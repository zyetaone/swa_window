/**
 * DirectorConfig — when things change.
 *
 * Covers: daylight progression (manual vs real-time sync), autopilot
 * randomizer (weather / location cycling), and scenario picker settings.
 */

import type { WeatherType } from '$lib/types';

export class DaylightConfig {
	/** If true, timeOfDay tracks wall clock; if false, user/admin drives it. */
	syncToRealTime = $state(true);
	/** Manual time-of-day 0-24 (only used when syncToRealTime=false). */
	manualTimeOfDay = $state(12);
	/** Real-time sync tick interval (ms). */
	syncIntervalMs = $state(60_000);
}

export class AutopilotConfig {
	enabled = $state(true);
	/** Intervals for the "next change" scheduler (seconds). */
	initialMinDelay    = $state(120);
	initialMaxDelay    = $state(300);
	subsequentMinDelay = $state(180);
	subsequentMaxDelay = $state(480);
	/** Weather transition chance per cycle. */
	weatherChangeChance = $state(0.2);
	/** Weighted weather pool (cloudy doubled, storm excluded). */
	weatherPool = $state<readonly WeatherType[]>(['clear', 'cloudy', 'cloudy', 'rain', 'overcast']);
	/** Flight director auto-cycling interval (seconds). */
	directorMinInterval = $state(120);
	directorMaxInterval = $state(300);
}

export class AmbientDriftConfig {
	/** Drift magnitudes applied per randomization cycle. */
	cloudDensityShift = $state(0.3);
	cloudDensityMin   = $state(0.2);
	cloudDensityMax   = $state(1.0);
	cloudSpeedShift   = $state(0.4);
	cloudSpeedMin     = $state(0.2);
	cloudSpeedMax     = $state(1.5);
	hazeShift         = $state(0.04);
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
			},
		};
	}
}
