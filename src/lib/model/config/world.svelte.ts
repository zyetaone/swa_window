/**
 * WorldConfig — tunable parameters for the map underneath.
 *
 * SSOT: default values come from `constants.ts` CESIUM + CESIUM_QUALITY_PRESETS.
 * `$state` wraps them so admin push can mutate at runtime. If you tune a
 * value, touch constants.ts only — class defaults will pick it up.
 */

import type { QualityMode } from '$lib/types';
import { CESIUM, CESIUM_QUALITY_PRESETS } from '$lib/constants';

export class WorldConfig {
	// ── Night-time imagery composition ───────────────────────────────────────
	baseNightBrightness: number = $state(CESIUM.BASE_NIGHT_BRIGHTNESS);
	baseNightSaturation: number = $state(CESIUM.BASE_NIGHT_SATURATION);
	nightAlpha: number          = $state(CESIUM.NIGHT_ALPHA);
	nightBrightness: number     = $state(CESIUM.NIGHT_BRIGHTNESS);
	nightContrast: number       = $state(CESIUM.NIGHT_CONTRAST);

	// ── Bloom post-process ───────────────────────────────────────────────────
	bloomContrast: number   = $state(CESIUM.BLOOM_CONTRAST);
	bloomBrightness: number = $state(CESIUM.BLOOM_BRIGHTNESS);
	bloomSigma: number      = $state(CESIUM.BLOOM_SIGMA);

	// ── Terrain + buildings ──────────────────────────────────────────────────
	defaultExaggeration  = $state(1.0);
	fogDensityScale      = $state(1.0);
	buildingsEnabled     = $state(true);
	overpassRadiusMeters = $state(3500);
	nightLightIntensity  = $state(0.6);

	// ── Quality preset — default 'balanced' and its per-field expansion ──────
	qualityMode = $state<QualityMode>('balanced');
	msse: number                   = $state(CESIUM_QUALITY_PRESETS.balanced.maximumScreenSpaceError);
	tileCache: number              = $state(CESIUM_QUALITY_PRESETS.balanced.tileCacheSize);
	preloadSiblings: boolean       = $state(CESIUM_QUALITY_PRESETS.balanced.preloadSiblings);
	preloadAncestors: boolean      = $state(CESIUM_QUALITY_PRESETS.balanced.preloadAncestors);
	loadingDescendantLimit: number = $state(CESIUM_QUALITY_PRESETS.balanced.loadingDescendantLimit);

	/**
	 * Expand a QualityMode label into the preset fields.
	 * Reads straight from CESIUM_QUALITY_PRESETS — single source of truth.
	 */
	syncFromMode(mode: QualityMode): void {
		const p = CESIUM_QUALITY_PRESETS[mode];
		this.msse                   = p.maximumScreenSpaceError;
		this.tileCache              = p.tileCacheSize;
		this.preloadSiblings        = p.preloadSiblings;
		this.preloadAncestors       = p.preloadAncestors;
		this.loadingDescendantLimit = p.loadingDescendantLimit;
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
