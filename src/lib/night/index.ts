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

// ── Thresholds (single source of truth) ─────────────────────────────────────

/**
 * nightFactor floor below which the car-lights geo-effect is hidden.
 * Dots fade in around dusk (nf crosses 0.2) and stay visible through
 * night → dawn until nf drops below 0.2 again.
 */
export const CAR_LIGHTS_NIGHT_THRESHOLD = 0.2;

/**
 * VIIRS night-lights alpha is gated by smoothstep(FLOOR, CEIL, nightFactor).
 * FLOOR=0.55 means pre-dawn/dusk nightFactor values (0.3..0.55 range)
 * keep VIIRS fully zero, avoiding magenta leak through colorToAlpha on
 * bright city cores. CEIL=0.9 reaches full VIIRS alpha at deep night.
 */
export const VIIRS_SMOOTHSTEP_FLOOR = 0.55;
export const VIIRS_SMOOTHSTEP_CEIL = 0.9;

/**
 * Cap on VIIRS alpha even at deep night. The NASA Black Marble tiles are
 * blocky and would paint a uniform amber wash at 1.0 — capping at 0.5
 * keeps them reading as "lit terrain" on top of the CartoDB dark base.
 */
export const VIIRS_MAX_ALPHA = 0.5;

/**
 * CartoDB dark-overlay gate. Linear lerp from nightFactor=0.01 meant
 * morning terrain (nf ~0.25 at 6:30 AM Dubai) got ~15% dark wash, which
 * leaves fresh EOX imagery looking pre-dimmed. Floor=0.45 keeps visible
 * morning (nf < 0.45) fully clean; atmospheric darkening fades in
 * through late-dusk/early-night before the city lights do.
 *
 * Intentionally gentler than the VIIRS curve — sky darkening naturally
 * precedes visible city lights by 30+ minutes.
 */
export const NIGHT_MAP_SMOOTHSTEP_FLOOR = 0.45;
export const NIGHT_MAP_SMOOTHSTEP_CEIL = 0.9;
