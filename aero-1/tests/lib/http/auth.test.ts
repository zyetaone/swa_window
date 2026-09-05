/**
 * Shared admin bearer-auth helper. Same shape as the /api/wifi/reset gate
 * but reusable across all admin-only mutating routes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireAdminToken } from '$lib/http/auth';

const TOKEN = 'admin-test-token';

function fakeRequest(authHeader?: string): Request {
	const headers = new Headers();
	if (authHeader) headers.set('authorization', authHeader);
	return { headers } as unknown as Request;
}

beforeEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
});

afterEach(() => {
	delete process.env.AERO_ADMIN_TOKEN;
});

describe('requireAdminToken', () => {
	it('throws 503 when AERO_ADMIN_TOKEN is unset (fail closed)', () => {
		expect(() => requireAdminToken(fakeRequest(`Bearer ${TOKEN}`))).toThrow(
			expect.objectContaining({ status: 503 }),
		);
	});

	it('throws 401 when Authorization header is missing', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		expect(() => requireAdminToken(fakeRequest())).toThrow(
			expect.objectContaining({ status: 401 }),
		);
	});

	it('throws 401 on a wrong scheme', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		expect(() => requireAdminToken(fakeRequest(`Token ${TOKEN}`))).toThrow(
			expect.objectContaining({ status: 401 }),
		);
	});

	it('throws 401 on a mismatched token', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		expect(() => requireAdminToken(fakeRequest('Bearer wrong'))).toThrow(
			expect.objectContaining({ status: 401 }),
		);
	});

	it('throws 401 on same-length but different bytes (constant-time path)', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		const sameLen = 'X'.repeat(TOKEN.length);
		expect(() => requireAdminToken(fakeRequest(`Bearer ${sameLen}`))).toThrow(
			expect.objectContaining({ status: 401 }),
		);
	});

	it('accepts the correct bearer (no return value, no throw)', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		expect(() => requireAdminToken(fakeRequest(`Bearer ${TOKEN}`))).not.toThrow();
	});

	it('Bearer prefix is case-insensitive', () => {
		process.env.AERO_ADMIN_TOKEN = TOKEN;
		expect(() => requireAdminToken(fakeRequest(`bearer ${TOKEN}`))).not.toThrow();
		expect(() => requireAdminToken(fakeRequest(`BEARER ${TOKEN}`))).not.toThrow();
	});
});
