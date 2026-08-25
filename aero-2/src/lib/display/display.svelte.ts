/**
 * AeroDisplay — Svelte 5 root display simulation state container & Context DI.
 * Owns the reactive aircraft view pose, reactive PaneSettings, and simulation tick loop.
 */
import { getContext, setContext, untrack } from 'svelte';
import { calculateCameraView, type CameraView } from './flight/view.js';
import { resolveAtmosphere, type AtmosphereState } from './world/atmosphere.js';
import { nightFactor, sunPosition, type SunPosition } from './world/sun.js';
import { createSettings, type PaneSettings } from '#lib/settings/settings.svelte.js';

const DISPLAY_KEY = Symbol('AERO_DISPLAY');

export class AeroDisplay {
	readonly config: PaneSettings;
	view = $state<CameraView>({} as CameraView);
	fps = $state<number>(60);
	frameTimeMs = $state<number>(16.6);

	#lastTickTime = typeof performance !== 'undefined' ? performance.now() : 0;
	#frameCount = 0;
	#lastFpsUpdate = typeof performance !== 'undefined' ? performance.now() : 0;

	constructor(configOrParams?: PaneSettings | (() => PaneSettings)) {
		if (typeof configOrParams === 'function') {
			this.config = configOrParams();
		} else if (configOrParams) {
			this.config = configOrParams;
		} else {
			this.config = createSettings();
		}

		this.view = untrack(() => calculateCameraView(Date.now() / 1000, this.config));
	}

	get atmosphere(): AtmosphereState {
		return resolveAtmosphere(this.view.aglM);
	}

	get night(): number {
		return nightFactor(this.view.timeOfDay);
	}

	/** Where the sun is right now, over the place being flown. */
	get sun(): SunPosition {
		return sunPosition(
			this.view.wallSec,
			this.config.place.lat,
			this.config.place.utcOffset + this.config.clockOffsetH
		);
	}

	advanceTo(wallSec: number = Date.now() / 1000): CameraView {
		if (typeof performance !== 'undefined') {
			const now = performance.now();
			const delta = now - this.#lastTickTime;
			this.#lastTickTime = now;
			this.#frameCount++;

			if (now - this.#lastFpsUpdate >= 500) {
				this.fps = Math.round((this.#frameCount * 1000) / (now - this.#lastFpsUpdate));
				this.frameTimeMs = Number(delta.toFixed(1));
				this.#frameCount = 0;
				this.#lastFpsUpdate = now;
			}
		}

		const next = calculateCameraView(wallSec, this.config);
		this.view = next;
		return next;
	}
}

export function createDisplay(configOrParams?: PaneSettings | (() => PaneSettings)): AeroDisplay {
	const display = new AeroDisplay(configOrParams);
	setContext(DISPLAY_KEY, display);
	return display;
}

export function useDisplay(): AeroDisplay {
	const ctx = getContext<AeroDisplay>(DISPLAY_KEY);
	if (!ctx) {
		throw new Error('useDisplay() called outside of AeroDisplay provider context');
	}
	return ctx;
}
