import { describe, it, expect } from 'vitest';
import { corsPreflight, lanCorsHeaders } from '#lib/server/cors.js';

/**
 * The wall is three panes. One of them can hold the 3.7 GB DEM and serve it to
 * the other two, which is what PUBLIC_TILE_SERVER_URL and the LAN CORS
 * allowlist exist for -- but the allowlist admitted only `*.local` and
 * `localhost`, while `/api/status` advertises `lanIps` and `primaryLanIp` as
 * IPv4 literals. The one topology it was written for was the one it rejected.
 */
describe('LAN CORS admits the fleet and nothing else', () => {
	const allow = (origin: string) => Object.keys(lanCorsHeaders(origin)).length > 0;

	it('admits the addresses panes actually use', () => {
		for (const o of [
			'http://aero-1.local:3000',
			'http://localhost:5173',
			'http://192.168.1.42:3000',
			'http://172.20.10.3:3000',
			'http://10.0.0.5:3000',
			'http://127.0.0.1:3000',
			'http://100.98.156.5:3000' // Tailscale CGNAT — how the Pis reach each other off-switch
		]) {
			expect(allow(o), `${o} should be allowed`).toBe(true);
		}
	});

	it('refuses anything routable from outside the wall', () => {
		for (const o of [
			'https://evil.com',
			'http://8.8.8.8',
			'http://172.32.0.1', // just outside 172.16/12
			'http://100.63.0.1', // just below the CGNAT block
			'http://100.128.0.1', // just above it
			'http://aero.local.evil.com', // suffix attack on the mDNS branch
			'http://192.168.1.42.evil.com' // suffix attack on the IPv4 branch
		]) {
			expect(allow(o), `${o} must NOT be allowed`).toBe(false);
		}
	});
});

/**
 * The preflight answered GET and nothing else. A cross-origin request carrying
 * Authorization or `content-type: application/json` triggers a preflight that
 * asks for those headers by name, and an answer that omits
 * Access-Control-Allow-Headers fails it — so the gap stayed invisible while
 * every route was public, and `curl` never reproduced it because `curl` does
 * not preflight.
 */
describe('corsPreflight advertises the headers a gated route needs', () => {
	/**
	 * A standalone `Headers` rather than a `Request`: `Origin` is a forbidden
	 * header name, so the test environment silently drops it from a Request's
	 * headers and every assertion below would pass against an empty response for
	 * the wrong reason. `corsPreflight` only ever reads `.headers`.
	 */
	const preflight = (origin: string) =>
		corsPreflight('GET, OPTIONS')({ request: { headers: new Headers({ origin }) } as Request });

	it('allows Authorization and Content-Type from a fleet origin', () => {
		const allow = preflight('http://192.168.1.42:3000').headers.get('access-control-allow-headers');
		expect(allow).toBeTruthy();
		expect(allow!.toLowerCase()).toContain('authorization');
		expect(allow!.toLowerCase()).toContain('content-type');
	});

	it('says nothing at all to an origin off the fleet', () => {
		const res = preflight('https://evil.example.com');
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('access-control-allow-headers')).toBeNull();
	});
});
