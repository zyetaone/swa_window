/**
 * WorldConfig — tunable parameters for the map underneath.
 *
 * Covers: base imagery night-dim, CartoDB night overlay, bloom post-process,
 * terrain exaggeration + fog, 3D buildings, night-light intensity, quality
 * preset. Every field is admin-push-mutable via `setPath(path, value)`.
 *
 * Values mirror the current `constants.ts` CESIUM block + existing WindowModel
 * fields. Phase 3+ migrates `world/compose.ts` (the Cesium adapter) to read
 * from here instead of importing constants directly.
 */

import type { QualityMode } from '$lib/types';

export class WorldConfig {
	baseNightBrightness = $state(0.15);
	baseNightSaturation = $state(0.25);
	nightAlpha      = $state(0.8);
	nightBrightness = $state(1.6);
	nightContrast   = $state(1.6);
	bloomContrast   = $state(128);
	bloomBrightness = $state(-0.3);
	// Narrowed from 3.5 — the wider Gaussian was smearing palette colors
	// onto surrounding terrain/ocean, producing visible purple/red bleeds.
	// 2.2 keeps halos soft + merging at road-intersection scale without the
	// contamination.
	bloomSigma      = $state(2.2);
	defaultExaggeration = $state(1.0);
	fogDensityScale     = $state(1.0);
	buildingsEnabled    = $state(true);
	overpassRadiusMeters = $state(3500);
	nightLightIntensity = $state(0.6);
	qualityMode = $state<QualityMode>('balanced');

	/** Cesium terrain quality parameters — one set per QualityMode. */
	msse      = $state(5);
	tileCache = $state(100);
	preloadSiblings   = $state(true);
	preloadAncestors   = $state(true);
	loadingDescendantLimit = $state(6);

	/**
	 * Populate terrain quality fields from a QualityMode label.
	 * Mirrors CESIUM_QUALITY_PRESETS. Call this when qualityMode changes.
	 */
	syncFromMode(mode: QualityMode): void {
		switch (mode) {
			case 'performance':
				this.msse = 8; this.tileCache = 50;
				this.preloadSiblings = false; this.preloadAncestors = true; this.loadingDescendantLimit = 4;
				break;
			case 'balanced':
				this.msse = 5; this.tileCache = 100;
				this.preloadSiblings = true; this.preloadAncestors = true; this.loadingDescendantLimit = 6;
				break;
			case 'ultra':
				this.msse = 2; this.tileCache = 200;
				this.preloadSiblings = true; this.preloadAncestors = true; this.loadingDescendantLimit = 8;
				break;
		}
	}

	/** Path-targeted mutation — for fleet v2 config_patch messages. */
	setPath(path: string, value: unknown): boolean {
		switch (path) {
			case 'baseNightBrightness':  this.baseNightBrightness  = value as number;      return true;
			case 'baseNightSaturation':  this.baseNightSaturation  = value as number;      return true;
			case 'nightAlpha':           this.nightAlpha           = value as number;      return true;
			case 'nightBrightness':      this.nightBrightness      = value as number;      return true;
			case 'nightContrast':        this.nightContrast        = value as number;      return true;
			case 'bloomContrast':        this.bloomContrast        = value as number;      return true;
			case 'bloomBrightness':      this.bloomBrightness      = value as number;      return true;
			case 'bloomSigma':           this.bloomSigma           = value as number;      return true;
			case 'defaultExaggeration':  this.defaultExaggeration  = value as number;      return true;
			case 'fogDensityScale':      this.fogDensityScale      = value as number;      return true;
			case 'buildingsEnabled':     this.buildingsEnabled     = value as boolean;     return true;
			case 'overpassRadiusMeters': this.overpassRadiusMeters = value as number;      return true;
			case 'nightLightIntensity':  this.nightLightIntensity  = value as number;      return true;
			case 'qualityMode':          this.qualityMode          = value as QualityMode; return true;
			case 'msse':                 this.msse                 = value as number; return true;
			case 'tileCache':            this.tileCache            = value as number; return true;
			case 'preloadSiblings':      this.preloadSiblings      = value as boolean; return true;
			case 'preloadAncestors':      this.preloadAncestors      = value as boolean; return true;
			case 'loadingDescendantLimit': this.loadingDescendantLimit = value as number; return true;
			default: return false;
		}
	}

	toJSON() {
		return {
			baseNightBrightness:  this.baseNightBrightness,
			baseNightSaturation:  this.baseNightSaturation,
			nightAlpha:           this.nightAlpha,
			nightBrightness:      this.nightBrightness,
			nightContrast:        this.nightContrast,
			bloomContrast:        this.bloomContrast,
			bloomBrightness:      this.bloomBrightness,
			bloomSigma:           this.bloomSigma,
			defaultExaggeration:  this.defaultExaggeration,
			fogDensityScale:      this.fogDensityScale,
			buildingsEnabled:     this.buildingsEnabled,
			overpassRadiusMeters: this.overpassRadiusMeters,
			nightLightIntensity:  this.nightLightIntensity,
			qualityMode:          this.qualityMode,
			msse:                  this.msse,
			tileCache:             this.tileCache,
			preloadSiblings:       this.preloadSiblings,
			preloadAncestors:       this.preloadAncestors,
			loadingDescendantLimit: this.loadingDescendantLimit,
		};
	}
}
