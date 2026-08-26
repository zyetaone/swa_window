/**
 * AeroDisplay — Svelte 5 root display simulation state container & Context DI.
 * Owns the reactive aircraft view pose, reactive PaneSettings, and simulation tick loop.
 */
import { getContext, setContext, untrack } from 'svelte';
import { calculateCameraView, type CameraView } from './flight/view.js';
import { FlightDirector } from './flight/director.svelte.js';
import { resolveAtmosphere, type AtmosphereState } from './world/atmosphere.js';
import { nightAmount, sunPosition, type SunPosition } from './world/sun.js';
import { createSettings, type PaneSettings } from '#lib/settings/settings.svelte.js';

const DISPLAY_KEY = Symbol('AERO_DISPLAY');

export class AeroDisplay {
	readonly config: PaneSettings;
	readonly director: FlightDirector;
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

		this.director = new FlightDirector(this.config);
		this.view = untrack(() => calculateCameraView(Date.now() / 1000, this.config));
	}

	get atmosphere(): AtmosphereState {
		return resolveAtmosphere(this.view.aglM);
	}

	/**
	 * Read by Ground, Terrain, Sky, Clouds, Buildings and CesiumStage. All six
	 * used to inherit a clock-only curve that disagreed with `sun` below.
	 */
	get night(): number {
		return nightAmount(this.sun.elevationDeg);
	}

	/** Where the sun is right now, over the place being flown. */
	get sun(): SunPosition {
		return sunPosition(
			this.view.wallSec,
			this.config.place.lat,
			this.config.place.utcOffset + this.config.clockOffsetH
		);
	}

	advanceLocation(): void {
		this.director.advanceDestination(Date.now() / 1000);
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

		// Wall clock, not a frame delta: the destination is derived from the
		// second, so every pane lands on the same place without being told.
		this.director.tick(wallSec);

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
