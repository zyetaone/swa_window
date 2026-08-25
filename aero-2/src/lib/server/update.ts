/**
 * Server OTA Updater & Privileged Service Execution.
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

import { spawn, spawnSync } from 'node:child_process';

/**
 * Fire-and-forget execution of a privileged command.
 *
 * Runs after a short delay so the HTTP response (202 Accepted) can be cleanly
 * transmitted before the process is terminated/restarted by the systemd service.
 *
 * @param argv Command and arguments array (e.g. `['sudo', '-n', 'systemctl', 'start', 'aero-updater.service']`)
 * @param delayMs Milliseconds to wait before spawning the detached process (default: 500ms)
 * @param label Logging prefix for diagnostics
 * @returns boolean `true` if scheduled successfully or in non-Linux dev mode; `false` if `sudo -n` preflight failed.
 */
export function schedulePrivileged(
	argv: string[],
	delayMs = 500,
	label = '[server/update]'
): boolean {
	if (process.platform !== 'linux') {
		console.info(`${label} Non-Linux platform (${process.platform}) — simulated update trigger`);
		return true;
	}

	// Preflight non-interactive sudo capability (/etc/sudoers.d/aero)
	const preflight = spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' });
	if (preflight.status !== 0) {
		console.warn(
			`${label} sudo -n preflight failed. Verify /etc/sudoers.d/aero is installed. Command NOT scheduled.`
		);
		return false;
	}

	setTimeout(() => {
		try {
			const child = spawn(argv[0], argv.slice(1), {
				detached: true,
				stdio: 'ignore'
			});
			child.unref();
		} catch (err) {
			console.error(`${label} Failed to spawn privileged process:`, err);
		}
	}, delayMs);

	return true;
}

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
