/**
 * Auto-quality stepping — pure function returning the next quality preset
 * given the current mode and a measured FPS sample.
 *
 * Pulled off AeroWindow.#tickAutoQuality so the policy is visible next to
 * the other world/ concerns and testable without a SvelteKit runtime. The
 * timer (throttle to every 5 s) stays on AeroWindow since it's per-instance
 * accumulator state — this module is the pure decision.
 */

import { QUALITY_MODES, type QualityMode } from '$lib/types';

/**
 * Bands: below 20 fps → step down one level, above 40 fps → step up.
 * Returns the same mode if inside the hysteresis band, or if already at
 * the extreme of the available presets.
 */
export function nextQualityMode(fps: number, current: QualityMode): QualityMode {
	if (fps <= 0) return current;
	const idx = QUALITY_MODES.indexOf(current);
	if (fps < 20 && idx > 0) return QUALITY_MODES[idx - 1];
	if (fps > 40 && idx < QUALITY_MODES.length - 1) return QUALITY_MODES[idx + 1];
	return current;
}
