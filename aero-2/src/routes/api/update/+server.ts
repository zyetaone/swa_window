/**
 * POST /api/update — run the OTA updater now instead of waiting for the timer.
 *
 * aero-updater.timer already polls `release` every ~15 min. This is the
 * on-demand path: an operator pushes a fix and wants the wall to have it in
 * seconds. It starts the SAME unit the timer starts, so there is exactly one
 * update code path, rollback and health probe included. Nothing here
 * re-implements updating.
 *
 * Fire-and-forget by necessity: the updater restarts aero-app.service, which
 * kills the process serving this request. The 202 goes out first and the caller
 * must not wait for a result that can never arrive. Progress is observable
 * anyway — the device drops off, comes back, and its commit chip changes.
 *
 * `systemctl start` on an already-running oneshot is a no-op, so a double-click
 * cannot stack two updates.
 */

import { json } from '@sveltejs/kit';

import { requireBearer } from '#lib/server/auth.js';
import { corsPreflight, lanCorsHeaders } from '#lib/server/cors.js';
import { triggerOtaUpdate } from '#lib/server/update.js';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = corsPreflight('POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	const refusal = requireBearer(
		request,
		process.env.AERO_ADMIN_TOKEN,
		'update endpoint (AERO_ADMIN_TOKEN)'
	);
	if (refusal) return refusal;

	const cors = lanCorsHeaders(request.headers.get('origin'));

	// triggerOtaUpdate preflights `sudo -n`. If the hatch is unavailable, say so
	// with a 503 rather than a 202 that promises an update which will not happen.
	if (!triggerOtaUpdate()) {
		return json(
			{
				ok: false,
				message:
					'Privileged hatch unavailable (sudo -n preflight failed) — reinstall deploy/pi/install.sh to provision /etc/sudoers.d/aero.'
			},
			{ status: 503, headers: cors }
		);
	}

	return json(
		{
			ok: true,
			message:
				'Update triggered. The device will fetch `release`, rebuild and restart — expect it offline for about a minute, then watch its commit chip.'
		},
		{ status: 202, headers: cors }
	);
};
