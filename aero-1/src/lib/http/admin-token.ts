/**
 * Admin-token helpers for the browser side. Pairs with $lib/http/auth on the
 * server. The Pi serves the admin UI same-origin and is the only legitimate
 * caller of the gated routes, so the token lives in sessionStorage (cleared
 * on tab close) and is injected into outbound fetches as a Bearer header.
 *
 * Usage:
 *   const token = ensureAdminToken();
 *   if (!token) return;  // user cancelled the prompt
 *   await fetch('/api/content', { headers: adminAuthHeader(token), ... });
 *
 * If a request comes back 401, clear the cached token and prompt again on
 * next attempt — clearAdminToken() is the recovery hook.
 */

const KEY = 'aero-admin-token';

/**
 * Returns the cached admin token, prompting the operator if none is stored.
 * Returns null only if the user dismisses the prompt without entering one.
 */
export function ensureAdminToken(): string | null {
	if (typeof window === 'undefined') return null;
	const cached = sessionStorage.getItem(KEY);
	if (cached) return cached;
	const entered = window.prompt(
		'Admin token required (AERO_ADMIN_TOKEN). Set on the Pi via env var; ask whoever deployed the kiosk.',
	);
	if (!entered) return null;
	sessionStorage.setItem(KEY, entered);
	return entered;
}

export function clearAdminToken(): void {
	if (typeof window === 'undefined') return;
	sessionStorage.removeItem(KEY);
}

export function adminAuthHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}
