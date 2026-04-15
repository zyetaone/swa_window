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
	// ── Base imagery (Sentinel-2 / Mapbox / ESRI) night dimming ────────────
	baseNightBrightness = $state(0.15); // 15% of day brightness — near-black terrain
	baseNightSaturation = $state(0.25); // mostly desaturated — avoids vivid leakage

	// ── CartoDB Dark night overlay ─────────────────────────────────────────
	nightAlpha      = $state(0.8);
	nightBrightness = $state(1.6);
	nightContrast   = $state(1.6);

	// ── Bloom post-process ─────────────────────────────────────────────────
	bloomContrast   = $state(128);
	bloomBrightness = $state(-0.3);
	bloomSigma      = $state(3.5);

	// ── Terrain ────────────────────────────────────────────────────────────
	defaultExaggeration = $state(1.0);
	fogDensityScale     = $state(1.0);

	// ── Buildings (OSM) ────────────────────────────────────────────────────
	buildingsEnabled    = $state(true);
	overpassRadiusMeters = $state(3500);

	// ── Night lights ───────────────────────────────────────────────────────
	nightLightIntensity = $state(0.6);

	// ── Quality preset ─────────────────────────────────────────────────────
	qualityMode = $state<QualityMode>('balanced');

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
		};
	}
}
