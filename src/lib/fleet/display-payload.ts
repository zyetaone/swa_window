/**
 * Display-mode payloads for fleet `set_mode` — pure parse/validate SSOT.
 *
 * Wire:
 *   video       → payload is a single URL string
 *   screensaver → payload is JSON: { urls: string[], intervalSec?: number }
 *   flight      → payload ignored
 *
 * Allowed URLs: absolute http(s), or same-origin asset paths (`/api/assets/...`).
 * Admin should absolutize asset paths before fleet push (toAbsoluteMediaUrl).
 */

export const DEFAULT_SLIDESHOW_INTERVAL_SEC = 12;
export const MIN_SLIDESHOW_INTERVAL_SEC = 3;
export const MAX_SLIDESHOW_INTERVAL_SEC = 300;

/**
 * Hard caps so set_mode stays under publish-route's 4 KB body budget
 * (envelope + mode field leave ~3.5 KB for the JSON payload).
 */
export const MAX_SLIDESHOW_URLS = 24;
/** Max characters of the encoded screensaver JSON (or video URL string). */
export const MAX_SET_MODE_PAYLOAD_CHARS = 3500;

const ASSET_PATH = /^\/api\/assets\/[A-Za-z0-9._%-]+$/;

/** True when a string is a safe media URL for kiosk playback. */
export function isAllowedMediaUrl(raw: string): boolean {
	if (typeof raw !== 'string') return false;
	const s = raw.trim();
	if (!s || s.length > 2048) return false;
	if (ASSET_PATH.test(s)) return true;
	try {
		const u = new URL(s);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

/** True when the URL is a relative local asset path (needs absolutize for multi-Pi). */
export function isRelativeAssetUrl(url: string): boolean {
	return url.trim().startsWith('/api/assets/');
}

export type SlideshowSpec = {
	urls: string[];
	intervalSec: number;
};

/** Parse screensaver JSON payload. Returns null if unusable. */
export function parseSlideshowPayload(payload: string | undefined): SlideshowSpec | null {
	if (!payload || typeof payload !== 'string') return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const rec = parsed as Record<string, unknown>;
	if (!Array.isArray(rec.urls)) return null;
	const urls = rec.urls
		.filter((u): u is string => typeof u === 'string')
		.map((u) => u.trim())
		.filter(isAllowedMediaUrl);
	if (urls.length === 0) return null;
	let intervalSec = DEFAULT_SLIDESHOW_INTERVAL_SEC;
	if (typeof rec.intervalSec === 'number' && Number.isFinite(rec.intervalSec)) {
		intervalSec = Math.min(
			MAX_SLIDESHOW_INTERVAL_SEC,
			Math.max(MIN_SLIDESHOW_INTERVAL_SEC, Math.round(rec.intervalSec)),
		);
	}
	return { urls, intervalSec };
}

/** Build screensaver wire payload from admin UI state. */
export function encodeSlideshowPayload(urls: string[], intervalSec = DEFAULT_SLIDESHOW_INTERVAL_SEC): string {
	const clean = urls.map((u) => u.trim()).filter(isAllowedMediaUrl).slice(0, MAX_SLIDESHOW_URLS);
	const sec = Math.min(
		MAX_SLIDESHOW_INTERVAL_SEC,
		Math.max(MIN_SLIDESHOW_INTERVAL_SEC, Math.round(intervalSec)),
	);
	return JSON.stringify({ urls: clean, intervalSec: sec });
}

/**
 * Pre-flight admin check before POST /api/command.
 * Returns an operator-facing error string, or null if the payload will fit.
 */
export function setModePayloadError(
	mode: 'video' | 'screensaver',
	urlsOrVideo: string | readonly string[],
	intervalSec = DEFAULT_SLIDESHOW_INTERVAL_SEC,
): string | null {
	if (mode === 'video') {
		const url = typeof urlsOrVideo === 'string' ? urlsOrVideo.trim() : '';
		if (!isAllowedMediaUrl(url)) return 'video URL required (http(s) or /api/assets/…)';
		if (url.length > MAX_SET_MODE_PAYLOAD_CHARS) {
			return `video URL too long (max ${MAX_SET_MODE_PAYLOAD_CHARS} chars)`;
		}
		return null;
	}
	const urls = (Array.isArray(urlsOrVideo) ? urlsOrVideo : [])
		.map((u) => u.trim())
		.filter(isAllowedMediaUrl);
	if (urls.length === 0) return 'add at least one slideshow image';
	if (urls.length > MAX_SLIDESHOW_URLS) {
		return `too many images (max ${MAX_SLIDESHOW_URLS}; remove ${urls.length - MAX_SLIDESHOW_URLS})`;
	}
	const wire = encodeSlideshowPayload(urls, intervalSec);
	if (wire.length > MAX_SET_MODE_PAYLOAD_CHARS) {
		return `slideshow payload too large (${wire.length} chars; max ${MAX_SET_MODE_PAYLOAD_CHARS}). Use fewer/shorter URLs.`;
	}
	return null;
}

/** Parse video payload — single allowed URL, or null. */
export function parseVideoPayload(payload: string | undefined): string | null {
	if (!payload || typeof payload !== 'string') return null;
	const url = payload.trim();
	return isAllowedMediaUrl(url) ? url : null;
}

/**
 * Rewrite same-origin asset paths to absolute URLs so multi-Pi fleets fetch
 * media from the admin origin (where the file was uploaded), not each device's
 * empty local `/api/assets`. Already-absolute URLs pass through.
 *
 * `origin` is `window.location.origin` on the admin host (no trailing slash).
 */
export function toAbsoluteMediaUrl(url: string, origin: string): string {
	const u = url.trim();
	if (!u) return u;
	const base = origin.replace(/\/$/, '');
	if (u.startsWith('/api/assets/')) return `${base}${u}`;
	return u;
}

/** Map a list through toAbsoluteMediaUrl (preserves order). */
export function absolutizeMediaUrls(urls: readonly string[], origin: string): string[] {
	return urls.map((u) => toAbsoluteMediaUrl(u, origin));
}
