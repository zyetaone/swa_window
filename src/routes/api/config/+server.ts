/**
 * PATCH /api/config — accept a config patch from a peer (admin or leader).
 *
 * Body: { path, value, timestamp?, sourceId? }
 *
 * When the message carries {timestamp, sourceId}, receiver routes through
 * CRDT merge (applyRemoteConfigPatch) — incoming only applies if it wins
 * per-path LWW. Omitted → fall through to local-semantics applyConfigPatch
 * (stamps fresh, just for convenience in curl / admin with no cradled id).
 *
 * Actually applies on the BROWSER side via SSE publish — config state
 * lives in Svelte $state in the browser, not the Node process. This
 * endpoint's job is to deliver the patch to the local browser.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLimitedJson } from '$lib/http/body';
import { lanCorsHeaders, lanCorsHeadersFull } from '$lib/http/cors';
import { publish } from '$lib/fleet/sse-bus.server';

interface ConfigPatchBody {
	path: string;
	value: unknown;
	timestamp?: number;
	sourceId?: string;
}

export const OPTIONS: RequestHandler = ({ request }) => {
	return new Response(null, {
		status: 204,
		headers: lanCorsHeadersFull(request.headers.get('origin'), 'PATCH, OPTIONS'),
	});
};

export const PATCH: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const body = await readLimitedJson<ConfigPatchBody>(request, 4096);

	if (!body || typeof body.path !== 'string') {
		throw error(400, 'invalid config patch body');
	}

	publish({
		type: 'config_patch',
		data: {
			path: body.path,
			value: body.value,
			timestamp: body.timestamp,
			sourceId: body.sourceId,
		},
	});

	return json({ ok: true }, { headers: lanCorsHeaders(origin) });
};
