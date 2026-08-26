import { error } from '@sveltejs/kit';

/**
 * /admin is an operator surface, not a public one.
 *
 * It renders the kiosk's hostname, LAN interface addresses, memory and uptime,
 * and links every pane role and scene preset — a LAN device fingerprint plus a
 * remote control for the wall, with no auth in front of it. On the SWA install
 * that port sits on the client's network.
 *
 * Keyed off NODE_ENV rather than `$app/environment` because `svelte-kit sync`
 * cannot currently generate $app types in this tree, and because it is the same
 * switch `server/tiles.ts` already uses for its dev-only remote fallback.
 * Server-side, so the guard is not something a client can decline to run.
 *
 * ponytail: a 404 in production is the whole guard. If an operator ever needs
 * this from a laptop on the install LAN, the fix is a real credential — a
 * "hidden" URL on a shared network is not a control.
 *
 * WHAT THIS LOOKS LIKE FROM OUTSIDE, because it is easy to mis-test: the whole
 * app runs `ssr = false`, so GET /admin still returns 200 — that is the static
 * shell, served before any load function runs. The guard fires on the DATA
 * request: /admin/__data.json returns the 404 error node, and the browser
 * renders "404 Not found" with no cockpit. Verified both ways.
 *
 * So `curl -o /dev/null -w '%{http_code}' /admin` is NOT a test of this. It
 * reports 200 whether the guard works or not. Check __data.json, or load the
 * page.
 */
export function load() {
	if (process.env.NODE_ENV === 'production') error(404, 'Not found');
}
