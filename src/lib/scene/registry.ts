/**
 * Scene effect registry — single source of truth for what composites into the scene.
 *
 * Order here determines iteration order. z-index on each Effect determines
 * actual render stacking. Keep the array sorted by z for readability.
 */

import type { Effect } from './types';
import { carLights } from './effects/car-lights';
import { clouds } from './effects/clouds';
import { microEvents } from './effects/micro-events';

/**
 * Stock effect registry. Ordering preserves the DOM mount sequence; actual
 * stacking is controlled by Z (z-index per effect).
 *
 * Reframe (2026-05-22): every effect here is EARTH or SKY by conceptual
 * layer (see types.ts LayerKind). Earth/sky effects belong as Cesium
 * primitives or imagery layers (in src/lib/world/); pane should hold
 * only cabin chrome.
 *
 * Migrated so far:
 *   - viirsGrid (was DOM)  → src/lib/world/viirs-grid-layer.ts
 *                             (Cesium Entity + RectangleGraphics + canvas)
 *   - atmosphericHaze      → DELETED; Cesium fog.visualDensityScalar +
 *                             skyAtmosphere.brightnessShift carry the look
 *   - lightning (was DOM)  → src/lib/world/lightning-stage.ts
 *                             (Cesium PostProcessStage flashing the scene)
 *
 * Still debt:
 *   - clouds (CSS3D sprites) → should be CloudCollection / billboards
 *   - microEvents (DOM)      → should be Cesium billboards / points
 */
export const EFFECTS: readonly Effect[] = [
	carLights,        // earth — Cesium geo entities (correct shape)
	clouds,           // sky — CSS3D sprites (debt: migrate to CloudCollection / billboards)
	microEvents,      // sky — DOM bird/star/contrail (debt: migrate to Cesium billboards)
] as const;
