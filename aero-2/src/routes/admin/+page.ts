import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/**
 * /admin is an operator surface, not a public one.
 *
 * It renders the kiosk's hostname, LAN interface addresses, memory and uptime,
 * and it links every pane role and scene preset. On a fielded Pi that is a LAN
 * device fingerprint plus a remote control, reachable by anything on the
 * client's network that knows the path — there is no auth in front of it.
 *
 * ponytail: a 404 in production is the whole guard. If an operator ever needs
 * this from a laptop on the install LAN, the fix is a real credential, not
 * loosening this — a "hidden" URL on a shared network is not a control.
 */
export function load() {
	if (!dev) error(404, 'Not found');
}
