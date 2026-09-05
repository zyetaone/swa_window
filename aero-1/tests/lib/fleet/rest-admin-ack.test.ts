/**
 * RestAdminStore apply-ack — the admin side of the apply-ack protocol.
 *
 * A 200 from /api/command or /api/config only means "published to the SSE
 * bus". Each fan-out stamps one shared commandId; kiosks record it on apply
 * and echo it as `lastAppliedCommandId` in their 5 s /api/status heartbeat.
 * ackProgress correlates those echoes against the tracked fan-out targets.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestAdminStore, newCommandId } from '$lib/fleet/rest-admin.svelte';
import { __resetPeerTokenCacheForTests } from '$lib/http/peer-token';
import type { LocationId } from '$lib/types';

const PEERS = [
	{ deviceId: 'pi-self', host: 'aero-display-00.local', port: 5173, self: true },
	{ deviceId: 'pi-two', host: 'aero-display-01.local', port: 5173 },
];

function jsonRes(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

// Extra per-device fields merged into the /api/status responses — tests
// mutate this to simulate heartbeats arriving with (or without) the ack.
let statusExtra: Record<string, Record<string, unknown>>;
let httpCalls: Array<{ url: string; init?: RequestInit }>;

function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = String(input);
	httpCalls.push({ url, init });
	if (url.endsWith('/api/devices')) return Promise.resolve(jsonRes({ devices: PEERS }));
	// No admin token in tests — peerJsonHeaders falls back to unauthenticated.
	if (url.includes('/api/internal/token')) return Promise.resolve(new Response('nope', { status: 503 }));
	if (url.endsWith('/api/status')) {
		// The self peer's urlFor() resolves to window.location.origin, which
		// does not contain its mDNS host — match by elimination.
		const peer = PEERS.find((p) => url.includes(p.host)) ?? PEERS[0];
		return Promise.resolve(jsonRes({
			deviceId: peer.deviceId,
			hostname: peer.host,
			fps: 58,
			mode: 'flight',
			location: 'dubai',
			uptime: 10,
			lastSeen: Date.now(),
			...(statusExtra[peer.deviceId] ?? {}),
		}));
	}
	if (url.endsWith('/api/command')) return Promise.resolve(jsonRes({ ok: true }));
	if (url.endsWith('/api/config')) return Promise.resolve(jsonRes({ ok: true }));
	return Promise.reject(new Error(`unexpected fetch: ${url}`));
}

function bodies(path: string): Array<Record<string, unknown>> {
	return httpCalls
		.filter((c) => c.url.endsWith(path) && c.init?.body)
		.map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);
}

let store: RestAdminStore;

beforeEach(async () => {
	statusExtra = {};
	httpCalls = [];
	localStorage.clear();
	__resetPeerTokenCacheForTests();
	vi.stubGlobal('fetch', vi.fn(fetchImpl));
	store = new RestAdminStore();
	await store.refresh();
});

afterEach(() => {
	store.destroy();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('newCommandId', () => {
	it('returns unique non-empty strings', () => {
		const a = newCommandId();
		const b = newCommandId();
		expect(a.length).toBeGreaterThan(0);
		expect(a).not.toBe(b);
	});
});

describe('apply-ack correlation', () => {
	it('counts acked targets as their heartbeats echo the commandId', async () => {
		const cid = newCommandId();
		store.trackCommand(cid, ['pi-self', 'pi-two']);
		// Waiting-for-ack state: tracked, but no heartbeat has echoed yet.
		expect(store.ackProgress).toEqual({ applied: 0, total: 2 });

		statusExtra['pi-two'] = { lastAppliedCommandId: cid };
		await store.refreshStatus();
		expect(store.ackProgress).toEqual({ applied: 1, total: 2 });

		statusExtra['pi-self'] = { lastAppliedCommandId: cid };
		await store.refreshStatus();
		expect(store.ackProgress).toEqual({ applied: 2, total: 2 });
	});

	it('does not count a device echoing a STALE commandId', async () => {
		statusExtra['pi-self'] = { lastAppliedCommandId: 'older-push' };
		await store.refreshStatus();
		store.trackCommand('newer-push', ['pi-self', 'pi-two']);
		expect(store.ackProgress).toEqual({ applied: 0, total: 2 });
	});

	it('is null before any fan-out is tracked', () => {
		const fresh = new RestAdminStore();
		try {
			expect(fresh.ackProgress).toBeNull();
		} finally {
			fresh.destroy();
		}
	});
});

describe('commandId on the wire', () => {
	it('stamps one shared commandId into every per-device command body', async () => {
		const cid = newCommandId();
		await store.pushScene('pi-self', 'dubai' as LocationId, undefined, cid);
		await store.pushScene('pi-two', 'dubai' as LocationId, undefined, cid);
		const cmds = bodies('/api/command');
		expect(cmds).toHaveLength(2);
		for (const body of cmds) {
			expect(body.type).toBe('set_scene');
			expect(body.commandId).toBe(cid);
		}
	});

	it('omits commandId from commands when the caller does not pass one', async () => {
		await store.pushScene('pi-two', 'dubai' as LocationId);
		expect(bodies('/api/command')[0].commandId).toBeUndefined();
	});

	it('pushConfigPath attaches commandId only when provided — ambient peer-sync stays untagged', async () => {
		await store.pushConfigPath('pi-two', 'atmosphere.clouds.density', 0.5);
		await store.pushConfigPath('pi-two', 'atmosphere.clouds.density', 0.6, 'cid-9');
		const cfgs = bodies('/api/config');
		expect(cfgs).toHaveLength(2);
		expect(cfgs[0].commandId).toBeUndefined();
		expect(cfgs[1].commandId).toBe('cid-9');
	});
});
