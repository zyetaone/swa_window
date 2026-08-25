/**
 * Svelte 5 Context DI for AeroWindow.
 */
import { getContext, setContext } from 'svelte';
import { AeroWindow } from './window.svelte.js';
import type { WindowParams } from './params.js';

const AERO_WINDOW_KEY = Symbol('AERO_WINDOW');

export function createAeroWindow(params: WindowParams | (() => WindowParams)): AeroWindow {
	const window = new AeroWindow(params);
	setContext(AERO_WINDOW_KEY, window);
	return window;
}

export function useAeroWindow(): AeroWindow {
	const ctx = getContext<AeroWindow>(AERO_WINDOW_KEY);
	if (!ctx) {
		throw new Error('useAeroWindow() called outside of AeroWindow provider context');
	}
	return ctx;
}
