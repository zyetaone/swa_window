/**
 * AeroDisplay — Svelte 5 root display simulation state container & Context DI.
 * Owns the reactive aircraft view pose, reactive PaneConfig, and simulation tick loop.
 */
import { getContext, setContext, untrack } from 'svelte';
import { windowView, resolveAtmosphere, nightFactor, type WindowView } from './flight.js';
import { type AtmosphereState, type PaneParams } from '#lib/config.svelte.js';

const DISPLAY_KEY = Symbol('AERO_DISPLAY');

export class AeroDisplay {
	readonly config: PaneParams;
	/** The ONLY reactive thing here: one struct, replaced whole each tick. */
	view = $state<WindowView>({} as WindowView);

	constructor(config: PaneParams) {
		this.config = config;
		this.view = untrack(() => windowView(Date.now() / 1000, config));
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

export function createDisplay(config: PaneParams): AeroDisplay {
	const display = new AeroDisplay(config);
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
