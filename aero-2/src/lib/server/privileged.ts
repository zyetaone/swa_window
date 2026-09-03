/**
 * schedulePrivileged — fire-and-forget spawn of a command that needs sudo.
 *
 * Every caller hands the OS something that typically kills the very process
 * serving the request (an app restart, a network drop, a reboot), which is why
 * the spawn is delayed: the caller gets its 202 first, then the command runs.
 *
 * Semantics callers depend on:
 *   - Linux-only. Anywhere else it warns and no-ops, so dev hosts and tests
 *     exercise the route without the machine acting on it.
 *   - `detached` + `unref()`: the child must outlive this process, because the
 *     command may be what tears this process down.
 *   - `stdio: 'ignore'`: no TTY, so an interactive sudo prompt would hang
 *     forever — callers pass `sudo -n` to fail fast instead.
 *   - Returns false when the command was NOT scheduled. A `sudo -n true`
 *     preflight catches a missing /etc/sudoers.d/aero, which otherwise gave the
 *     operator a 202 and then silence: the worst failure mode on a headless
 *     fleet.
 *
 * It lives here rather than in `update.ts` because OTA is only its first
 * caller; anything else needing a privileged hatch imports this, not the
 * updater.
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
