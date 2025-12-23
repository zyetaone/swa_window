/**
 * Core State Management - Single Source of Truth
 *
 * WindowModel is the authoritative state. All components derive from it.
 * No callbacks, no duplicate state, no bidirectional sync.
 *
 * Usage:
 * 1. In root component: createAppState()
 * 2. In child components: useAppState()
 * 3. Access model: appState.model (or appState.viewer for backward compat)
 */

import { setContext, getContext } from 'svelte';
import { WindowModel, LOCATIONS, type LocationId, type WeatherType, type Location } from './WindowModel.svelte';
import { BLIND, AIRCRAFT } from './constants';

// Re-export from WindowModel
export { WindowModel, LOCATIONS };
export type { LocationId, WeatherType, Location };
export type { SkyState, SunPosition } from './types';
export type { BiomeColors } from './EnvironmentSystem';

// Re-export constants
export { BLIND, AIRCRAFT };

export interface AppState {
	model: WindowModel;
	viewer: WindowModel;  // Backward compat alias
}

const APP_STATE_KEY = Symbol('APP_STATE');

/**
 * Create app state and set context
 */
export function createAppState(): AppState {
	const model = new WindowModel();

	const state: AppState = {
		model,
		viewer: model,  // Same instance
	};

	setContext(APP_STATE_KEY, state);
	return state;
}

/**
 * Get app state from context
 */
export function useAppState(): AppState {
	const state = getContext<AppState>(APP_STATE_KEY);
	if (!state) {
		throw new Error('useAppState() called outside component tree');
	}
	return state;
}

/**
 * Get just the model
 */
export function useModel(): WindowModel {
	return useAppState().model;
}
