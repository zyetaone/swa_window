/**
 * Server OTA updater.
 *
 * Fire-and-forget triggering of the Pi's systemd updater unit
 * (`aero-updater.service`).
 *
 * NOT YET REACHABLE, and that is deliberate. Nothing imports this: aero-2 has
 * no `/api/update` route, because it has no auth layer yet. v1's equivalent is
 * bearer-gated with `requireAdminToken(request)` against AERO_ADMIN_TOKEN, and
 * this must not be exposed on any route until aero-2 has the same. An
 * unauthenticated endpoint that runs `sudo systemctl` is a remote restart for
 * anyone on the LAN.
 *
 * The argv is fixed at the call site rather than taken from a request, so there
 * is no injection surface — but reachability is the thing to get right, not
 * just escaping.
 */

import { spawnSync } from 'node:child_process';

import { schedulePrivileged } from '#lib/server/privileged.js';

/**
 * Triggers the on-demand fleet OTA updater on Raspberry Pi.
 * Runs `sudo -n systemctl start aero-updater.service`.
 */
export function triggerOtaUpdate(): boolean {
	return schedulePrivileged(
		['sudo', '-n', 'systemctl', 'start', 'aero-updater.service'],
		500,
		'[api/update]'
	);
}

/**
 * Returns the current application Git commit SHA if available.
 */
export function getAppCommit(): string {
	try {
		const res = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		if (res.status === 0 && res.stdout) {
			return res.stdout.trim();
		}
	} catch {
		// Fallback for non-git runtime environments
	}
	return 'dev';
}
