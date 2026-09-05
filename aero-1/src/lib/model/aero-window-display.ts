/**
 * Display-mode apply helpers for AeroWindow (flight | video | slideshow).
 *
 * Extracted from aero-window.svelte.ts so the mode LWW / payload gates stay
 * testable without the full tick/fleet surface. The class still owns the
 * $state fields; this module only runs the pure decision + field writes.
 */
import type { DisplayMode } from '$lib/types';
import {
	parseVideoPayload,
	parseSlideshowPayload,
	encodeSlideshowPayload,
	type SlideshowSpec,
} from '$lib/fleet/display-payload';
import { saveDisplayMode, peekDisplayModeSavedAt } from '$lib/fleet/display-mode-persist';

/** Minimal surface the display-mode apply needs from AeroWindow. */
export interface DisplayModeHost {
	displayMode: DisplayMode;
	videoUrl: string;
	slideshow: SlideshowSpec | null;
	telemetry: {
		recordEvent(kind: string, payload: Record<string, unknown>): void;
	};
}

export type SetDisplayModeOpts = { decidedAtMs?: number; force?: boolean };

/**
 * Apply a display mode onto `host`. Same semantics as AeroWindow.setDisplayMode.
 * @returns true if applied; false if rejected (stale LWW or bad payload).
 */
export function applyDisplayMode(
	host: DisplayModeHost,
	mode: DisplayMode,
	payload?: string,
	opts?: SetDisplayModeOpts,
): boolean {
	const at =
		typeof opts?.decidedAtMs === 'number' && Number.isFinite(opts.decidedAtMs)
			? opts.decidedAtMs
			: Date.now();
	if (!opts?.force) {
		const prevAt = peekDisplayModeSavedAt();
		if (prevAt > 0 && at < prevAt) {
			host.telemetry.recordEvent('info', {
				event: 'set_mode_rejected',
				mode,
				reason: 'stale_decision',
				decidedAtMs: at,
				savedAt: prevAt,
			});
			return false;
		}
	}

	if (mode === 'flight') {
		host.displayMode = 'flight';
		host.videoUrl = '';
		host.slideshow = null;
		saveDisplayMode('flight', undefined, at);
		return true;
	}
	if (mode === 'video') {
		const url = parseVideoPayload(payload);
		if (!url) {
			host.telemetry.recordEvent('info', {
				event: 'set_mode_rejected',
				mode,
				reason: 'invalid_video_url',
			});
			return false;
		}
		host.displayMode = 'video';
		host.videoUrl = url;
		host.slideshow = null;
		saveDisplayMode('video', url, at);
		return true;
	}
	// screensaver = image slideshow
	const spec = parseSlideshowPayload(payload);
	if (!spec) {
		host.telemetry.recordEvent('info', {
			event: 'set_mode_rejected',
			mode,
			reason: 'invalid_slideshow_payload',
		});
		return false;
	}
	host.displayMode = 'screensaver';
	host.slideshow = spec;
	host.videoUrl = '';
	saveDisplayMode('screensaver', encodeSlideshowPayload(spec.urls, spec.intervalSec), at);
	return true;
}
