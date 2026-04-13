/**
 * Core State Management - Single Source of Truth
 *
 * WindowModel is the authoritative simulation state.
 * Presentation derivations live in Window.svelte as local $derived values.
 *
 * All re-exports live here — no proxy files in core/. Constants, types,
 * locations, and utils are canonical in $lib/shared; this barrel re-exports
 * them so that $lib/state/* relative imports continue to resolve.
 *
 * Usage:
 *   In root component: createAppState()
 *   In child components: useAppState()
 */

import { setContext, getContext } from 'svelte';
import { WindowModel } from './WindowModel.svelte';

// --- Shared SSOT re-exports ---

// Constants
export {
	AIRCRAFT,
	CESIUM,
	FLIGHT_FEEL,
	WEATHER_EFFECTS,
	AMBIENT,
	MICRO_EVENTS,
	CESIUM_QUALITY_PRESETS,
} from '$lib/shared/constants';
export type { WeatherEffect, QualityMode } from '$lib/shared/constants';

// Locations
export { LOCATIONS, LOCATION_IDS, LOCATION_MAP } from '$lib/shared/locations';

// Utils
export { clamp, lerp, normalizeHeading, formatTime } from '$lib/shared/utils';

// Types
export type { SkyState, LocationId, WeatherType, Location } from '$lib/shared/types';

// --- Context API ---

const APP_STATE_KEY = Symbol('APP_STATE');

export function createAppState(): WindowModel {
	const model = new WindowModel();
	setContext(APP_STATE_KEY, model);
	return model;
}

export function useAppState(): WindowModel {
	const model = getContext<WindowModel>(APP_STATE_KEY);
	if (!model) {
		throw new Error('useAppState() called outside component tree');
	}
	return model;
}