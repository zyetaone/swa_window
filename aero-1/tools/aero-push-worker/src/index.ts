/**
 * Aero Push Worker
 *
 * Over-the-internet bundle + config push channel for z-aero-window devices.
 * Devices poll the read endpoints periodically. Admins POST to write endpoints.
 *
 * Endpoints:
 *   GET    /health                  → { ok, version }
 *   GET    /bundles/:deviceId       → ContentBundle[]    (filtered by targets)
 *   POST   /bundles                 → { ok, id }          (auth required)
 *   DELETE /bundles/:id             → { ok }              (auth required)
 *   GET    /configs/:deviceId       → ConfigPatch[]
 *   POST   /configs/:deviceId       → { ok, count }       (auth required)
 */

export interface Env {
	BUNDLES: KVNamespace;
	CONFIGS: KVNamespace;
	ADMIN_TOKEN: string;
	WORKER_VERSION?: string;
}

/** A pushable content bundle. Mirrors the device-side ContentBundle shape. */
interface ContentBundle {
	id: string;
	type: string;
	/** Device IDs this bundle targets, or ['*'] for all devices. */
	targets?: string[];
	/** Anything else — opaque to the Worker. */
	[key: string]: unknown;
}

interface ConfigPatch {
	path: string;
	value: unknown;
}

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	'Access-Control-Max-Age': '86400'
};

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
	});

const text = (body: string, status = 200): Response =>
	new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS } });

function isAuthorized(request: Request, env: Env): boolean {
	if (!env.ADMIN_TOKEN) return false;
	const header = request.headers.get('Authorization');
	if (!header) return false;
	const match = /^Bearer\s+(.+)$/.exec(header);
	if (!match) return false;
	// Constant-time compare to avoid timing side-channels.
	return safeEqual(match[1], env.ADMIN_TOKEN);
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}

function bundleTargetsDevice(bundle: ContentBundle, deviceId: string): boolean {
	if (!bundle.targets || bundle.targets.length === 0) return true; // default: all
	return bundle.targets.includes('*') || bundle.targets.includes(deviceId);
}

async function listBundles(env: Env): Promise<ContentBundle[]> {
	const out: ContentBundle[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.BUNDLES.list({ prefix: 'bundle:', cursor });
		for (const key of page.keys) {
			const raw = await env.BUNDLES.get(key.name);
			if (!raw) continue;
			try {
				out.push(JSON.parse(raw) as ContentBundle);
			} catch {
				/* skip malformed */
			}
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return out;
}

async function handleGetBundlesForDevice(env: Env, deviceId: string): Promise<Response> {
	const all = await listBundles(env);
	const filtered = all.filter((b) => bundleTargetsDevice(b, deviceId));
	return json(filtered);
}

async function handlePostBundle(request: Request, env: Env): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, 400);
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'bundle must be a JSON object' }, 400);
	}
	const bundle = body as ContentBundle;
	if (typeof bundle.id !== 'string' || bundle.id.length === 0) {
		return json({ error: 'bundle.id is required' }, 400);
	}
	if (typeof bundle.type !== 'string' || bundle.type.length === 0) {
		return json({ error: 'bundle.type is required' }, 400);
	}
	await env.BUNDLES.put(`bundle:${bundle.id}`, JSON.stringify(bundle));
	return json({ ok: true, id: bundle.id });
}

async function handleDeleteBundle(env: Env, id: string): Promise<Response> {
	await env.BUNDLES.delete(`bundle:${id}`);
	return json({ ok: true });
}

async function handleGetConfigs(env: Env, deviceId: string): Promise<Response> {
	const raw = await env.CONFIGS.get(`config:${deviceId}`);
	if (!raw) return json([]);
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return json([]);
		return json(parsed);
	} catch {
		return json([]);
	}
}

async function handlePostConfigs(
	request: Request,
	env: Env,
	deviceId: string
): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON' }, 400);
	}
	if (!Array.isArray(body)) {
		return json({ error: 'body must be an array of { path, value }' }, 400);
	}
	const valid = body.filter(
		(p): p is ConfigPatch =>
			!!p && typeof p === 'object' && typeof (p as ConfigPatch).path === 'string'
	);
	await env.CONFIGS.put(`config:${deviceId}`, JSON.stringify(valid));
	return json({ ok: true, count: valid.length });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(request.url);
		const segments = url.pathname.split('/').filter(Boolean);
		const route = `${request.method} /${segments[0] ?? ''}`;

		try {
			// GET /health
			if (route === 'GET /health') {
				return json({ ok: true, version: env.WORKER_VERSION ?? '0.1.0' });
			}

			// GET /bundles/:deviceId
			if (route === 'GET /bundles' && segments.length === 2) {
				return handleGetBundlesForDevice(env, decodeURIComponent(segments[1]));
			}

			// POST /bundles
			if (route === 'POST /bundles' && segments.length === 1) {
				if (!isAuthorized(request, env)) return text('unauthorized', 401);
				return handlePostBundle(request, env);
			}

			// DELETE /bundles/:id
			if (route === 'DELETE /bundles' && segments.length === 2) {
				if (!isAuthorized(request, env)) return text('unauthorized', 401);
				return handleDeleteBundle(env, decodeURIComponent(segments[1]));
			}

			// GET /configs/:deviceId
			if (route === 'GET /configs' && segments.length === 2) {
				return handleGetConfigs(env, decodeURIComponent(segments[1]));
			}

			// POST /configs/:deviceId
			if (route === 'POST /configs' && segments.length === 2) {
				if (!isAuthorized(request, env)) return text('unauthorized', 401);
				return handlePostConfigs(request, env, decodeURIComponent(segments[1]));
			}

			return text('not found', 404);
		} catch (err) {
			console.error('worker error', err);
			return json({ error: 'internal error' }, 500);
		}
	}
} satisfies ExportedHandler<Env>;
