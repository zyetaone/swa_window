/**
 * Persist last fleet display mode so kiosk reload keeps video/slideshow.
 * Separate key from scene persistence — media is operator-driven, not daily show.
 */
import { isValidDisplayMode, type DisplayMode } from '$lib/types';
import { parseSlideshowPayload, parseVideoPayload } from './display-payload';

export const DISPLAY_MODE_STORAGE_KEY = 'aero.displayMode.v1';

export type StoredDisplayMode = {
	mode: DisplayMode;
	/** Wire payload for video/screensaver; omitted for flight. */
	payload?: string;
};

export function saveDisplayMode(mode: DisplayMode, payload?: string): void {
	if (typeof window === 'undefined') return;
	try {
		const body: StoredDisplayMode =
			mode === 'flight' ? { mode: 'flight' } : { mode, payload };
		localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, JSON.stringify(body));
	} catch {
		/* storage full / blocked */
	}
}

/** Load a still-valid mode+payload, or null. */
export function loadDisplayMode(): StoredDisplayMode | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const rec = parsed as Record<string, unknown>;
		if (!isValidDisplayMode(rec.mode)) return null;
		const mode = rec.mode;
		if (mode === 'flight') return { mode: 'flight' };
		const payload = typeof rec.payload === 'string' ? rec.payload : undefined;
		if (mode === 'video' && !parseVideoPayload(payload)) return null;
		if (mode === 'screensaver' && !parseSlideshowPayload(payload)) return null;
		return { mode, payload };
	} catch {
		return null;
	}
}
