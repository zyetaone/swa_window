/**
 * engines.ts — which renderer draws the world.
 *
 * A leaf on purpose. The list was previously a bare union spelled out in the
 * settings state, again in the URL parser, again in the preset schema and once
 * more as an array in the engine picker. Declaring it beside either of its
 * consumers puts `settings` and `presets` in an import cycle, which invariant
 * #1 forbids, so it lives next to the stages it names.
 *
 * List first, type derived — the same shape as `WEATHERS` and `FLEET_ROLES`.
 */
export const ENGINES = ['maplibre', 'cesium'] as const;
export type Engine = (typeof ENGINES)[number];
