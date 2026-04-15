/**
 * Scene effect registry — single source of truth for what composites into the scene.
 *
 * Order here determines iteration order. z-index on each Effect determines
 * actual render stacking. Keep the array sorted by z for readability.
 */

import type { Effect } from './types';
import carLights from './effects/car-lights';
import atmosphericHaze from './effects/atmospheric-haze';
import clouds from './effects/clouds';
import lightning from './effects/lightning';
import microEvents from './effects/micro-events';

export const EFFECTS: readonly Effect[] = [
	carLights,        // z:0 — geo (renders inside Cesium; compositor-z is inert)
	atmosphericHaze,  // z:0 — atmo (DOM-order above Cesium, below clouds)
	clouds,           // z:1 — atmo
	lightning,        // z:2 — atmo
	microEvents,      // z:3 — atmo
] as const;
