/**
 * Core State Management - Single Source of Truth
 *
 * WindowModel is the authoritative simulation state.
 * Presentation derivations live in Window.svelte as local $derived values.
 *
 * Usage:
 * 1. In root component: createAppState()
 * 2. In child components: useAppState()
 */

import { setContext, getContext } from 'svelte';
import { WindowModel } from './WindowModel.svelte';

// Re-export everything from @zyeta/shared for convenience
export { AIRCRAFT, CESIUM, FLIGHT_FEEL, WEATHER_EFFECTS, LOCATIONS, LOCATION_MAP } from '@zyeta/shared';
export type { SkyState, LocationId, WeatherType, Location } from '@zyeta/shared';

const APP_STATE_KEY = Symbol('APP_STATE');

/**
 * Create app state and set context
 */
export function createAppState(): WindowModel {
	const model = new WindowModel();
	setContext(APP_STATE_KEY, model);
	return model;
}

/**
 * Get app state from context
 */
export function useAppState(): WindowModel {
	const model = getContext<WindowModel>(APP_STATE_KEY);
	if (!model) {
		throw new Error('useAppState() called outside component tree');
	}
	return model;
}
