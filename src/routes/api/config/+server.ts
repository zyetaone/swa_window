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
import { lanCorsHeaders, corsPreflight } from '$lib/http/cors';
import { publish } from '$lib/fleet/sse-bus.server';

interface ConfigPatchBody {
	path: string;
	value: unknown;
	timestamp?: number;
	sourceId?: string;
}

// Allowlist of namespaces that a remote PATCH may write to. Mirrors the
// NAMESPACES map in $lib/model/config-tree.svelte. Server-side check is
// belt-and-braces alongside setByPath's __proto__/constructor/prototype
// rejection on the browser — even if a future setByPath change weakens
// the defense, this gate stops the dangerous path-prefix at the wire.
const ALLOWED_NAMESPACES = new Set(['atmosphere', 'camera', 'director', 'world', 'shell']);

function isAllowedPath(path: string): boolean {
	if (path.length === 0 || path.length > 200) return false;
	// Segments must be ASCII identifier-shaped — no separators, no exotic
	// keys ("__proto__" included by virtue of the leading underscores).
	if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(path)) return false;
	const ns = path.slice(0, path.indexOf('.'));
	return ALLOWED_NAMESPACES.has(ns);
}

export const OPTIONS: RequestHandler = corsPreflight('PATCH, OPTIONS');

export const PATCH: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('origin');
	const body = await readLimitedJson<ConfigPatchBody>(request, 4096);

	if (!body || typeof body.path !== 'string') {
		throw error(400, 'invalid config patch body');
	}
	if (!isAllowedPath(body.path)) {
		throw error(400, 'config path rejected: must match `<namespace>.<key>[…]` with namespace in (atmosphere, camera, director, world, shell)');
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
