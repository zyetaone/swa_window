/**
 * Device identity — THE single resolver.
 *
 * Two independent resolvers used to share the `aero-device-id` localStorage
 * key with DIFFERENT precedence (fleet client: ?device= → stored → generated;
 * CF-Worker remote poll: stored → hostname → uuid). They only agreed because
 * the fleet client's onMount happened to run first in +page.svelte source
 * order — an unenforced accident. Diverged identities would split a Pi
 * across two ids: the CRDT sourceId tiebreak under one, the CF-Worker
 * per-device OTA config queue under another (pushed configs silently never
 * arrive). One resolver, superset precedence:
 *
 *   1. `?device=` URL param — operator field-assignment; persisted so the
 *      role survives reload without the query string. Overwriting a
 *      DIFFERENT stored id logs a console.warn: reassignment is rare
 *      post-install, and the param is unauthenticated — a visible signal
 *      catches both misconfiguration and spoofing attempts cheaply.
 *   2. stored `aero-device-id` — fielded Pis keep their identity forever.
 *   3. `window.location.hostname` when non-localhost — Pis have stable
 *      mDNS hostnames (aero-display-NN.local), the most operator-legible id.
 *   4. generated `display-<ts>-<rand>`, persisted.
 *
 * Framework-free; safe from any module (no fleet/model imports).
 */

const KEY = 'aero-device-id';

function read(): string | null {
	try {
		return window.localStorage.getItem(KEY);
	} catch {
		return null; // localStorage unavailable (private mode, kiosk lockdown)
	}
}

function persist(id: string): void {
	try {
		window.localStorage.setItem(KEY, id);
	} catch {
		/* best-effort */
	}
}

export function resolveDeviceId(): string {
	if (typeof window === 'undefined') return 'unknown';

	const urlId = new URLSearchParams(window.location.search).get('device');
	if (urlId) {
		const stored = read();
		if (stored && stored !== urlId) {
			console.warn(`[device-id] ?device=${urlId} overwrites stored id ${stored} — field reassignment or spoof?`);
		}
		persist(urlId);
		return urlId;
	}

	const stored = read();
	if (stored && stored.length > 0) return stored;

	const host = window.location.hostname;
	if (host && host !== 'localhost' && host !== '127.0.0.1') {
		persist(host);
		return host;
	}

	const fresh = `display-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	persist(fresh);
	return fresh;
}
