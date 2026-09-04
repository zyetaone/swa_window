/**
 * Server OTA updater.
 *
 * Fire-and-forget triggering of the Pi's systemd updater unit
 * (`aero-updater.service`).
 *
 * STILL NOT REACHABLE. No `/api/update` route exists yet. The reason used to be
 * that aero-2 had no auth layer; since Phase 1 it has one, so the remaining
 * condition is explicit: the route that exposes this must call
 * `requireBearer(request, env.AERO_ADMIN_TOKEN, 'update (AERO_ADMIN_TOKEN)')`
 * and return its Response when non-null, before touching anything here. An
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
