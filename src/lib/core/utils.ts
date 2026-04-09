/**
 * Re-export of shared utility functions. SSOT lives in `$lib/shared/utils`.
 * Kept here so existing `./utils` and `$lib/core/utils` imports continue
 * to resolve without path changes.
 */
export { clamp, lerp, normalizeHeading, formatTime } from '$lib/shared/utils';
