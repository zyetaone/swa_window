/**
 * POST /api/update — run the OTA updater NOW instead of waiting for the timer.
 *
 * aero-updater.timer already polls `release` every ~15 min. This is the
 * on-demand path: an operator pushes a fix and wants the wall to have it in
 * seconds, not at the next tick. It runs the SAME unit the timer runs, so
 * there is exactly one update code path — including its rollback and health
 * probe. Nothing here re-implements updating.
 *
 * Fire-and-forget by necessity: aero-updater.sh restarts aero-app.service,
 * which kills the very process serving this request. So we schedule the
 * trigger a beat out and return 202 immediately — the caller must not wait
 * for a result that can never arrive. Progress is observable without a status
 * endpoint: /admin polls each device's /api/status every 5 s and renders the
 * commit chip, so the device drops offline, comes back, and the chip changes.
 *
 * Bearer-gated (AERO_ADMIN_TOKEN), matching /api/config and /api/command.
 * Fail-closed 503 when unset — a Pi that didn't opt in has no remote-restart
 * lever at all rather than an open one.
 *
 * `systemctl start` on an already-running oneshot unit is a no-op, so a
 * double-click can't stack two updates.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { lanCorsHeaders, corsPreflight } from '$lib/http/cors';
import { requireAdminToken } from '$lib/http/auth';
import { schedulePrivileged } from '$lib/server/schedule-privileged';

export const OPTIONS: RequestHandler = corsPreflight('POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	requireAdminToken(request);
	const origin = request.headers.get('origin');
	scheduleUpdate();
	return json(
		{
			ok: true,
			message:
				'Update triggered. The device will fetch `release`, rebuild, and restart — expect it offline for ~1 min, then watch its commit chip.',
		},
		{ status: 202, headers: lanCorsHeaders(origin) },
	);
};

/** Internal — only meaningful on the Pi (uses sudo + systemctl). */
function scheduleUpdate(): void {
	// Detached + delayed: this process is about to be restarted by the very
	// unit it starts, so the child must not be tied to its lifetime and the
	// 202 must go out first. See schedulePrivileged.
	schedulePrivileged(['sudo', '-n', 'systemctl', 'start', 'aero-updater.service'], 500, '[api/update]');
}
