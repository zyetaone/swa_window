/**
 * AeroDisplay — Svelte 5 root display simulation state container & Context DI.
 * Owns the reactive aircraft view pose, reactive PaneConfig, and simulation tick loop.
 */
import { getContext, setContext, untrack } from 'svelte';
import { windowView, resolveAtmosphere, nightFactor, type WindowView } from './flight.js';
import { PaneConfig, createPaneConfig, type AtmosphereState, type PaneParams } from '#lib/config.svelte.js';

const DISPLAY_KEY = Symbol('AERO_DISPLAY');

export class AeroDisplay {
	readonly config: PaneConfig;
	view = $state<WindowView>({} as WindowView);

	constructor(configOrParams?: PaneConfig | PaneParams | (() => PaneParams)) {
		if (typeof configOrParams === 'function') {
			const initial = configOrParams();
			this.config = initial instanceof PaneConfig ? initial : createPaneConfig(initial);
		} else if (configOrParams instanceof PaneConfig) {
			this.config = configOrParams;
		} else {
			this.config = createPaneConfig(configOrParams);
		}

		this.view = untrack(() => windowView(Date.now() / 1000, this.config));
	}

	get params(): PaneParams {
		return this.config;
	}

	get atmosphere(): AtmosphereState {
		return resolveAtmosphere(this.view.aglM);
	}

	get night(): number {
		return nightFactor(this.view.timeOfDay);
	}

	tick(wallSec: number = Date.now() / 1000): WindowView {
		const next = windowView(wallSec, this.config);
		this.view = next;
		return next;
	}
}

export function createDisplay(configOrParams?: PaneConfig | PaneParams | (() => PaneParams)): AeroDisplay {
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
