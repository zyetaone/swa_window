/**
 * LAN-origin CORS allowlist. These tests pin the regex so a future
 * "simplification" can't accidentally widen it. The fleet REST surface
 * relies on this gate to stay LAN-scoped.
 */

import { describe, it, expect } from 'vitest';
import { lanCorsHeaders, lanCorsHeadersFull, corsPreflight } from '$lib/http/cors';

describe('lanCorsHeaders', () => {
	it('reflects *.local origins', () => {
		expect(lanCorsHeaders('http://aero-display-01.local')).toEqual({
			'Access-Control-Allow-Origin': 'http://aero-display-01.local',
			Vary: 'Origin',
		});
	});

	it('reflects *.local with port', () => {
		expect(lanCorsHeaders('http://admin-laptop.local:5173')).toEqual({
			'Access-Control-Allow-Origin': 'http://admin-laptop.local:5173',
			Vary: 'Origin',
		});
	});

	it('reflects localhost (no port)', () => {
		const h = lanCorsHeaders('http://localhost');
		expect(h['Access-Control-Allow-Origin']).toBe('http://localhost');
	});

	it('reflects localhost with port', () => {
		const h = lanCorsHeaders('http://localhost:5173');
		expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
	});

	it('accepts https as well as http', () => {
		expect(lanCorsHeaders('https://aero-display-01.local')['Access-Control-Allow-Origin']).toBe(
			'https://aero-display-01.local',
		);
	});

	it('emits no headers when Origin is absent', () => {
		expect(lanCorsHeaders(null)).toEqual({});
		expect(lanCorsHeaders(undefined)).toEqual({});
		expect(lanCorsHeaders('')).toEqual({});
	});

	it('rejects public-internet origins', () => {
		expect(lanCorsHeaders('http://example.com')).toEqual({});
		expect(lanCorsHeaders('https://google.com')).toEqual({});
		expect(lanCorsHeaders('http://1.2.3.4')).toEqual({});
	});

	it('rejects sneaky .local lookalikes', () => {
		// extra labels: not a flat *.local
		expect(lanCorsHeaders('http://evil.x.local')).toEqual({});
		// .local as a non-trailing label
		expect(lanCorsHeaders('http://evil.local.attacker.com')).toEqual({});
		// dot inside the hostname segment
		expect(lanCorsHeaders('http://malicious.com.local')).toEqual({});
	});

	it('rejects userinfo / credentials in the origin', () => {
		expect(lanCorsHeaders('http://user:pass@x.local')).toEqual({});
	});

	it('rejects non-http(s) schemes', () => {
		expect(lanCorsHeaders('file://x.local')).toEqual({});
		expect(lanCorsHeaders('ftp://x.local')).toEqual({});
		expect(lanCorsHeaders('javascript:alert(1)')).toEqual({});
	});

	it('rejects IDN-style cyrillic homoglyphs (ASCII-only allowlist)', () => {
		expect(lanCorsHeaders('http://сyrillic.local')).toEqual({});
	});
});

describe('lanCorsHeadersFull', () => {
	it('adds Allow-Methods + Allow-Headers when origin is allowed', () => {
		const h = lanCorsHeadersFull('http://x.local', 'PATCH, OPTIONS');
		expect(h['Access-Control-Allow-Methods']).toBe('PATCH, OPTIONS');
		expect(h['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
	});

	// Regression: every route behind this preflight is bearer-gated, and the
	// admin dashboard talks to peer Pis cross-origin. Dropping Authorization
	// from the allowlist makes browsers fail the preflight and never send the
	// request, so cross-device pushes silently no-op while curl still works.
	it('allows the Authorization header the bearer-gated routes require', () => {
		for (const methods of ['PATCH, OPTIONS', 'POST, OPTIONS', undefined]) {
			const h = methods
				? lanCorsHeadersFull('http://x.local', methods)
				: lanCorsHeadersFull('http://x.local');
			expect(h['Access-Control-Allow-Headers']).toMatch(/\bAuthorization\b/i);
		}
	});

	it('emits nothing when origin is denied', () => {
		expect(lanCorsHeadersFull('http://example.com', 'PATCH, OPTIONS')).toEqual({});
	});

	it('defaults methods to GET, POST, OPTIONS', () => {
		const h = lanCorsHeadersFull('http://x.local');
		expect(h['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
	});
});

describe('corsPreflight', () => {
	// happy-dom strips the `Origin` header from Request constructors
	// (browser-side fetch spec restriction). For these tests we hand the
	// handler a plain stub that exposes the same shape — request.headers.get —
	// which is all corsPreflight actually consumes.
	function fakeRequest(origin: string | null): { request: Request } {
		const headers = new Headers();
		// Headers does accept 'origin'; the restriction is on Request init.
		if (origin !== null) headers.set('origin', origin);
		return { request: { headers } as unknown as Request };
	}

	it('returns a handler that emits 204 with the preflight headers', () => {
		const handler = corsPreflight('PATCH, OPTIONS');
		const res = handler(fakeRequest('http://x.local'));
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-methods')).toBe('PATCH, OPTIONS');
		expect(res.headers.get('access-control-allow-origin')).toBe('http://x.local');
	});

	it('still 204s for denied origins, with no CORS headers (browser blocks)', () => {
		const handler = corsPreflight('PATCH, OPTIONS');
		const res = handler(fakeRequest('http://attacker.com'));
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('still 204s when there is no Origin header at all', () => {
		const handler = corsPreflight('PATCH, OPTIONS');
		const res = handler(fakeRequest(null));
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});
});
