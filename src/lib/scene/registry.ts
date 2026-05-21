/**
 * Scene effect registry — single source of truth for what composites into the scene.
 *
 * Order here determines iteration order. z-index on each Effect determines
 * actual render stacking. Keep the array sorted by z for readability.
 */

import type { Effect } from './types';
import { carLights } from './effects/car-lights';
import { atmosphericHaze } from './effects/haze';
import { clouds } from './effects/clouds';
import { lightning } from './effects/lightning';
import { microEvents } from './effects/micro-events';

/**
 * Stock effect registry. Ordering preserves the DOM mount sequence; actual
 * stacking is controlled by Z (z-index per effect).
 *
 * Reframe (2026-05-22): every effect here is currently EARTH or SKY by
 * conceptual layer (see types.ts LayerKind). Today most ship as DOM
 * components — that's a known migration debt: earth/sky effects should
 * live as Cesium primitives or imagery layers (in src/lib/world/), and the
 * pane should hold only cabin chrome. The procedural-imagery migration
 * starts that move.
 */
export const EFFECTS: readonly Effect[] = [
	carLights,        // earth — Cesium geo entities (correct shape)
	atmosphericHaze,  // sky — DOM gradient (debt: should be Cesium fog only)
	clouds,           // sky — CSS3D sprites (debt: migrate to CloudCollection / billboards)
	lightning,        // sky — DOM flash (debt: migrate to PostProcessStage)
	microEvents,      // sky — DOM bird/star/contrail (debt: migrate to Cesium billboards)
] as const;
