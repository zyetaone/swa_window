import { error } from '@sveltejs/kit';

/**
 * /admin is an operator surface, not a public one.
 *
 * It renders the kiosk's hostname, LAN interface addresses, memory and uptime,
 * and links every pane role and scene preset — a LAN device fingerprint plus a
 * remote control for the wall, with no auth in front of it. On the SWA install
 * that port sits on the client's network.
 *
 * FAIL-CLOSED, and it was not until 2026-09-03. The guard read
 * `NODE_ENV === 'production'`, so the surface was exposed by DEFAULT and
 * closed only when one specific string was present. Every other gate in this
 * repo is the other way round: `requireBearer` 503s on an unset token, and
 * `remoteFallbackEnabled` opens only for the literal 'development'. This one
 * was the exception, and the exception was the one that leaks.
 *
 * That is not theoretical. `tools/smoke-routes.mjs` DELETES `NODE_ENV` on the
 * grounds — stated in its own comment — that unset is "the Pi's own
 * configuration". Both statements cannot be true: either the fielded device
 * sets production and the smoke run does not reproduce it, or the device runs
 * unset and /admin was wide open on the install LAN. Verified against the
 * built server: unset returns the cockpit's data node, production returns the
 * 404. Today `deploy/pi/aero-app.service` does set production, so the fielded
 * v1 is closed — but that unit's WorkingDirectory still points at v1, and
 * aero-2 inherits the guard without inheriting the unit. A security boundary
 * that holds only because of a line in a systemd file the app has not migrated
 * to yet is not a boundary, it is a coincidence.
 *
 * So the switch is now an explicit opt-in that names itself, rather than the
 * absence of a string that means something else. `AERO_ADMIN_UI=1` turns the
 * cockpit on; anything else — unset, empty, production, a typo — serves 404.
 * `bun run dev` sets it in the `dev` script, so the local workflow is
 * unchanged.
 *
 * ponytail: a 404 is still the whole guard. If an operator needs this from a
 * laptop on the install LAN, the fix is `requireBearer` — which already
 * exists, is tested, and is what /api/update is blocked on. An env flag is a
 * deployment control, not a credential.
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
	if (process.env.AERO_ADMIN_UI !== '1') error(404, 'Not found');
}
