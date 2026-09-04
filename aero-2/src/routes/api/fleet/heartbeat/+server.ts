/**
 * Fleet heartbeat.
 *
 * POST — each Pi, every 60 s, from deploy/pi/health-check.sh. Bearer-gated on
 *   AERO_FLEET_TOKEN: a lower-privilege credential than the admin token,
 *   because it is provisioned into every device's config.env and a script that
 *   only reports temperature should not also be able to reboot the wall.
 *
 * GET — the rollup, token-free so an admin laptop on the LAN can poll it
 *   cross-origin without holding a credential. In exchange it serves no
 *   `lastError`: that is a raw journal line, and GET has no idea who is asking.
 */

import { json } from '@sveltejs/kit';

import { requireBearer } from '#lib/server/auth.js';
import { readLimitedJson } from '#lib/server/body.js';
import { corsPreflight, lanCorsHeaders, withCors } from '#lib/server/cors.js';
import { latestAll, recordHeartbeat, summarize } from '#lib/server/heartbeat.js';
import type { RequestHandler } from './$types';

/**
 * 8 KB. The real payload is about 300 bytes; this is 25x that and still a tight
 * bound on what an unauthenticated-until-parsed request can make us buffer.
 */
const MAX_HEARTBEAT_BYTES = 8 * 1024;

export const OPTIONS: RequestHandler = corsPreflight('GET, POST, OPTIONS');

export const POST: RequestHandler = async ({ request }) => {
	const refusal = requireBearer(
		request,
		process.env.AERO_FLEET_TOKEN,
		'fleet heartbeat (AERO_FLEET_TOKEN)'
	);
	const cors = lanCorsHeaders(request.headers.get('origin'));
	if (refusal) return withCors(refusal, cors);

	const body = await readLimitedJson<unknown>(request, MAX_HEARTBEAT_BYTES);
	if (!body.ok) return withCors(body.response, cors);

	const sample = recordHeartbeat(body.value);
	if (!sample) return json({ error: 'invalid heartbeat payload' }, { status: 400, headers: cors });

	return json({ ok: true, receivedAtMs: sample.receivedAtMs }, { headers: cors });
};

export const GET: RequestHandler = ({ request, url }) => {
	const cors = lanCorsHeaders(request.headers.get('origin'));
	return json(url.searchParams.has('summary') ? summarize() : latestAll(), { headers: cors });
};
