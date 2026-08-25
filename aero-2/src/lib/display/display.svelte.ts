/**
 * AeroDisplay — Svelte 5 root display simulation state container & Context DI.
 * Owns the reactive aircraft view pose, reactive PaneConfig, and simulation tick loop.
 */
import { getContext, setContext, untrack } from 'svelte';
import { windowView, type WindowView } from './flight/camera.js';
import { resolveAtmosphere, type AtmosphereState } from './atmosphere/bands.js';
import { nightFactor } from './atmosphere/sun.js';
import { createPaneConfig, type PaneConfig } from '#lib/config.svelte.js';

const DISPLAY_KEY = Symbol('AERO_DISPLAY');

export class AeroDisplay {
	readonly config: PaneConfig;
	view = $state<WindowView>({} as WindowView);

	constructor(configOrParams?: PaneConfig | (() => PaneConfig)) {
		if (typeof configOrParams === 'function') {
			this.config = configOrParams();
		} else if (configOrParams) {
			this.config = configOrParams;
		} else {
			this.config = createPaneConfig();
		}

		this.view = untrack(() => windowView(Date.now() / 1000, this.config));
	}

	get params(): PaneConfig {
		return this.config;
	}

	get atmosphere(): AtmosphereState {
		return resolveAtmosphere(this.view.aglM);
	}

	get night(): number {
		return nightFactor(this.view.timeOfDay);
	}

	advanceTo(wallSec: number = Date.now() / 1000): WindowView {
		const next = windowView(wallSec, this.config);
		this.view = next;
		return next;
	}
}

export function createDisplay(configOrParams?: PaneConfig | (() => PaneConfig)): AeroDisplay {
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
