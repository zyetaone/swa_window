/**
 * LAN guard on the admin bearer token.
 *
 * Peer hosts come from mDNS SRV targets — trivially spoofable UDP. A rogue
 * responder can announce an off-LAN target (evil.com, a public IP) and, if
 * the Authorization header rides along, harvest AERO_ADMIN_TOKEN and gain
 * full fleet control. These tests pin the boundary in
 * `$lib/http/peer-token` (isLanHost) and its wiring into the two modules
 * that push to peers: DeviceClient.publishV2 and RestAdminStore.
 *
 * Policy: the token is attached only for loopback / localhost / *.local
 * hosts — the shapes lan-peers discovery legitimately produces. The request
 * itself still goes out unauthenticated (same as the token-unavailable
 * path); the receiving end just rejects it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	peerJsonHeaders,
	isLanHost,
	__resetPeerTokenCacheForTests,
} from '$lib/http/peer-token';
import { DeviceClient } from '$lib/fleet/client.svelte';
import { RestAdminStore } from '$lib/fleet/rest-admin.svelte';
import type { FleetClientModel } from '$lib/fleet/protocol';

const TOKEN = 'kiosk-bearer-abc';

const PEERS = [
	{ deviceId: 'good', host: 'aero-display-01.local', port: 3000 },
	{ deviceId: 'evil', host: 'evil.com', port: 443 },
];

function okResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

interface RecordedCall {
	url: string;
	headers: Record<string, string>;
}

/** fetch mock: serves the local token + device list, records everything else. */
function installFetchMock(): { sent: RecordedCall[]; sawDevicesFetch: () => boolean } {
	const sent: RecordedCall[] = [];
	let devicesFetched = false;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('/api/internal/token')) return okResponse({ token: TOKEN });
		if (url.includes('/api/devices')) {
			devicesFetched = true;
			return okResponse({ devices: PEERS });
		}
		sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
		return okResponse({});
	}) as unknown as typeof fetch;
	return { sent, sawDevicesFetch: () => devicesFetched };
}

class FakeEventSource {
	closed = false;
	addEventListener(): void { /* no events needed for these tests */ }
	close(): void { this.closed = true; }
}

function makeModel(): FleetClientModel {
	return {
		measuredFps: 60,
		displayMode: 'flight',
		location: 'dubai',
		weather: 'clear',
		qualityMode: 'balanced',
		syncToRealTime: false,
		applyScene: vi.fn(),
		setDisplayMode: vi.fn(),
		setQualityMode: vi.fn(),
		setAltitude: vi.fn(),
		setTime: vi.fn(),
		setFlightSpeed: vi.fn(),
	} as unknown as FleetClientModel;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
	__resetPeerTokenCacheForTests();
	localStorage.clear();
	vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.unstubAllGlobals();
	localStorage.clear();
});

// ─── isLanHost ──────────────────────────────────────────────────────────────

describe('isLanHost', () => {
	it('accepts mDNS .local hostnames (what lan-peers SRV targets produce)', () => {
		expect(isLanHost('aero-display-01.local')).toBe(true);
	});

	it('accepts loopback spellings and localhost', () => {
		expect(isLanHost('127.0.0.1')).toBe(true);
		expect(isLanHost('localhost')).toBe(true);
		expect(isLanHost('::1')).toBe(true);
	});

	it('normalises case and a trailing mDNS root dot', () => {
		expect(isLanHost('AERO-DISPLAY-01.LOCAL')).toBe(true);
		expect(isLanHost('aero-display-01.local.')).toBe(true);
	});

	it('rejects off-LAN hosts a spoofed mDNS response could inject', () => {
		expect(isLanHost('evil.com')).toBe(false);
		expect(isLanHost('203.0.113.10')).toBe(false);
		expect(isLanHost('aero-display-01.local.evil.com')).toBe(false);
	});

	it('rejects numeric RFC1918 (matches the CORS allowlist policy)', () => {
		expect(isLanHost('192.168.1.42')).toBe(false);
	});
});

// ─── peerJsonHeaders(host) ──────────────────────────────────────────────────

describe('peerJsonHeaders host guard', () => {
	it('attaches the token for an mDNS .local peer', async () => {
		installFetchMock();
		const headers = await peerJsonHeaders('aero-display-01.local');
		expect(headers).toEqual({
			'Content-Type': 'application/json',
			Authorization: `Bearer ${TOKEN}`,
		});
	});

	it('attaches the token for loopback / localhost', async () => {
		installFetchMock();
		expect(await peerJsonHeaders('127.0.0.1')).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
		expect(await peerJsonHeaders('localhost')).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
	});

	it('withholds the token for a public DNS name', async () => {
		installFetchMock();
		const headers = await peerJsonHeaders('evil.com');
		expect(headers).toEqual({ 'Content-Type': 'application/json' });
		expect(headers).not.toHaveProperty('Authorization');
	});

	it('withholds the token for a public IP', async () => {
		installFetchMock();
		const headers = await peerJsonHeaders('203.0.113.10');
		expect(headers).not.toHaveProperty('Authorization');
	});

	it('keeps legacy always-attach behaviour when no host is given', async () => {
		installFetchMock();
		const headers = await peerJsonHeaders();
		expect(headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
	});
});

// ─── DeviceClient.publishV2 wiring ──────────────────────────────────────────

describe('DeviceClient.publishV2 token guard', () => {
	it('sends the token only to the LAN peer, not the spoofed off-LAN one', async () => {
		const { sent, sawDevicesFetch } = installFetchMock();
		const client = new DeviceClient(makeModel());
		try {
			// Wait for the constructor's #refreshPeers to land before broadcasting.
			await vi.waitFor(() => expect(sawDevicesFetch()).toBe(true));
			await new Promise((r) => setTimeout(r, 20));

			client.publishV2({ v: 2, type: 'director_decision', locationId: 'mumbai', transitionAtMs: Date.now() + 2500 });

			await vi.waitFor(() => {
				expect(sent.some((c) => c.url.includes('aero-display-01.local'))).toBe(true);
				expect(sent.some((c) => c.url.includes('evil.com'))).toBe(true);
			});

			const good = sent.find((c) => c.url.includes('aero-display-01.local'))!;
			const evil = sent.find((c) => c.url.includes('evil.com'))!;
			expect(good.headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
			expect(evil.headers).not.toHaveProperty('Authorization');
			expect(evil.headers).toHaveProperty('Content-Type', 'application/json');
		} finally {
			client.destroy();
		}
	});
});

// ─── RestAdminStore wiring ──────────────────────────────────────────────────

describe('RestAdminStore token guard', () => {
	it('attaches the token for a .local peer across all mutating routes', async () => {
		const { sent } = installFetchMock();
		const store = new RestAdminStore();
		try {
			await store.refresh();

			await store.pushScene('good', 'mumbai');
			await store.pushConfigPath('good', 'atmosphere.clouds.density', 0.5);
			await store.triggerUpdate('good');

			const paths = ['/api/command', '/api/config', '/api/update'];
			for (const path of paths) {
				const call = sent.find((c) => c.url.includes('aero-display-01.local') && c.url.includes(path));
				expect(call, `expected ${path} call to good peer`).toBeDefined();
				expect(call!.headers).toHaveProperty('Authorization', `Bearer ${TOKEN}`);
			}
		} finally {
			store.destroy();
		}
	});

	it('withholds the token from an off-LAN peer across all mutating routes', async () => {
		const { sent } = installFetchMock();
		const store = new RestAdminStore();
		try {
			await store.refresh();

			await store.pushScene('evil', 'mumbai');
			await store.pushConfigPath('evil', 'atmosphere.clouds.density', 0.5);
			await store.triggerUpdate('evil');

			const evilCalls = sent.filter((c) => c.url.includes('evil.com'));
			expect(evilCalls.length).toBeGreaterThanOrEqual(3);
			for (const call of evilCalls) {
				expect(call.headers, `${call.url} must not carry the token`).not.toHaveProperty('Authorization');
			}
		} finally {
			store.destroy();
		}
	});
});
