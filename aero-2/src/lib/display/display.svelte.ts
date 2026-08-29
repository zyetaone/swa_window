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
	/**
	 * Overwritten in the constructor before anything can read it.
	 *
	 * The placeholder is a lie for exactly the length of the constructor body,
	 * and it used to leak: consumers defended against it with `?? 0` on every
	 * field, which is unreachable today AND converts any future genuine absence
	 * into a plausible zero -- a heading of 0 deg, an altitude of 0 m. Those
	 * defaults are gone; if this is ever read before assignment, it must throw
	 * rather than render north at sea level.
	 */
	view = $state<CameraView>({} as CameraView);
	fps = $state<number>(60);
	frameTimeMs = $state<number>(16.6);

	/**
	 * How often the terrain actually answered, versus falling back to the mean.
	 *
	 * This exists because the DEM can fail in a way that emits no error at all.
	 * The archive serves 206s, the bytes arrive, the tiles sit in state
	 * `loading` forever, and `queryTerrainElevation` returns nothing -- so the
	 * regional mean wins every frame, the camera flies a sensible altitude, and
	 * the ground is drawn at sea level underneath it. MapLibre raises nothing;
	 * there is no error event to listen for. The failure is success-shaped.
	 *
	 * A percentage on the diagnostics panel is the smallest thing that makes it
	 * visible: `0% sampled` says the elevation you are looking at is not real.
	 */
	terrain = $state({ sampled: 0, fallback: 0 });

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

	/**
	 * Share of recent frames where real terrain was measured, 0-100.
	 *
	 * Reads 0 when no DEM tile has decoded, which is the whole point.
	 */
	get terrainSampledPct(): number {
		const n = this.terrain.sampled + this.terrain.fallback;
		return n === 0 ? 0 : (100 * this.terrain.sampled) / n;
	}

	/**
	 * Record one clearance resolution. Called from the frame loop.
	 *
	 * Halved rather than reset once the window is large enough, so the figure
	 * tracks the last few thousand frames instead of averaging over uptime -- a
	 * DEM that starts working after ten minutes should show up promptly, not be
	 * buried under the hours that preceded it.
	 */
	noteClearance(sampled: boolean): void {
		if (sampled) this.terrain.sampled++;
		else this.terrain.fallback++;
		if (this.terrain.sampled + this.terrain.fallback > 4000) {
			this.terrain.sampled = Math.round(this.terrain.sampled / 2);
			this.terrain.fallback = Math.round(this.terrain.fallback / 2);
		}
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
		if (this.config.rotate) this.director.tick(wallSec);

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
