/**
 * Night rendering pipeline — barrel hub.
 *
 * The night look of the app is produced by five cooperating pieces in
 * four different directories:
 *
 *   1. Sky-state derivation — `utils.getSkyState / nightFactor / dawnDuskFactor`
 *      turn decimal time-of-day into a categorical state + two 0..1 factors.
 *
 *   2. Base darkening — `world/compose.ts` lerps baseLayer.brightness and
 *      baseLayer.saturation toward `world.baseNightBrightness / baseNightSaturation`
 *      as nightFactor rises. This is what makes the EOX day imagery fade
 *      to muted desaturated night ground.
 *
 *   3. VIIRS city lights — `world/compose.ts` composites NASA VIIRS Black
 *      Marble over the base layer. Alpha follows a smoothstep(0.55, 0.9,
 *      nightFactor) curve — linear lerp leaked magenta onto dawn terrain
 *      via hue-rotated colorToAlpha on bright city cores.
 *
 *   4. Post-process color grading — `world/shaders.ts` (COLOR_GRADING_GLSL)
 *      runs after the full scene. Reads `u_nightFactor`, `u_dawnDuskFactor`,
 *      `u_lightIntensity`. Adds warm pollution corona on bright pixels,
 *      crushes shadows, tints horizon haze toward amber at dawn/dusk.
 *
 *   5. Per-effect visibility — `atmosphere/haze/HazeEffect.svelte` switches
 *      color by skyState; `scene/effects/car-lights/CarLightsEffect.svelte`
 *      gates Cesium point entities on `nightFactor > CAR_LIGHTS_NIGHT_THRESHOLD`.
 *
 * This barrel re-exports the tunables + pure functions. New code that
 * touches night rendering should import from here, so the pipeline's
 * membership is visible at import time.
 */

export { getSkyState, nightFactor, dawnDuskFactor } from '$lib/utils';
export { COLOR_GRADING_GLSL } from '$lib/world/shaders';

// ── Time-of-day thresholds (SSOT for all night consumers) ──────────────────

/**
 * Time-of-day thresholds for the night/dawn/dusk rendering pipeline.
 * All values are decimal hours in local time (same space as model.timeOfDay).
 * Editing one value here keeps all consumers aligned automatically.
 */
export const T = {
	/** Night ends; dawn transition begins. */
	DAWN_START:  5,
	/** Dawn ends; full daylight. */
	DAY_START:   7,
	/** Full daylight ends; dusk transition begins. */
	DAY_END:    18,
	/** Dusk ends; night begins (blue hour is included in dusk). */
	DUSK_END:   21,
	/** dawnDusk factors reach zero; nightFactor reaches one. */
	DEEP_NIGHT: 22,
} as const;

// ── Thresholds (single source of truth) ─────────────────────────────────────

/**
 * nightFactor floor below which the car-lights geo-effect is hidden.
 * Dots fade in around dusk (nf crosses 0.2) and stay visible through
 * night → dawn until nf drops below 0.2 again.
 */
export const CAR_LIGHTS_NIGHT_THRESHOLD = 0.2;

// (Phase 11: VIIRS_MAX_ALPHA + smoothstep thresholds + the palette globe
//  colour + sky shifts + exposure / atmosphereLight day anchors all moved
//  to $content/compositions/night.ts — the night targets now live in one
//  authored table. compose.ts reads from NIGHT_PALETTE rather than from
//  scattered constants here.)
// (Phase 15.5: CartoDB Dark imagery overlay gates were also dropped —
//  shader's mix() in COLOR_GRADING_GLSL carries that ramp now.)
