/**
 * Level-of-detail tuning — authored values, no logic.
 *
 * These live in content/ rather than beside the code that applies them because
 * they are the numbers you change while standing in front of the wall. None of
 * them encodes a rule; each is a judgement about how much detail is worth its
 * fill rate on a Pi, and every one of them will move once the three screens are
 * running.
 *
 * The damping thresholds that stop these from thrashing are NOT here — those
 * are mechanism, not taste, and live with the code that enforces them.
 */

/** Tile error in px when the ground is fully legible. The Pi ship-path value. */
export const SSE_GROUND = 8;

/** Tile error when the ground is a smear — fewer, coarser tiles. */
export const SSE_CRUISE = 24;

/**
 * How hard to coarsen tiles with DISTANCE.
 *
 * An oblique window sees to the horizon — ~357 km at 10 km altitude against
 * ~11 km looking straight down — so most of the frame is enormous ground area
 * compressed into very few pixels. Cesium's default is 2; this spends far less
 * out there, which is also physically honest, since air is not transparent for
 * 357 km.
 */
export const FOG_SSE_FACTOR = 16;
