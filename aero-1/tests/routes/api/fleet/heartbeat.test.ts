/**
 * /api/fleet/heartbeat — POST bearer gate + GET sanitisation.
 *
 * POST requires AERO_FLEET_TOKEN (fail-closed 503 when unset, 401 on a
 * wrong token). GET is deliberately token-free so the admin dashboard can
 * poll it cross-origin without a bearer — but internal-only debug fields
 * (the lastError journal line) must be stripped from every GET response.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, POST } from '../../../../src/routes/api/fleet/heartbeat/+server';
import { recordHeartbeat, latestAll, statsAll } from '$lib/server/fleet/heartbeat';

const TOKEN = 'fleet-bearer-token';

function post(body: unknown, token?: string) {
	const request = new Request('http://localhost/api/fleet/heartbeat', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

function get(query = '') {
	const request = new Request(`http://localhost/api/fleet/heartbeat${query}`);
	return GET({
		request,
		url: new URL(request.url),
	} as unknown as Parameters<typeof GET>[0]);
}

const SAMPLE = {
	deviceId: 'pi-gw-1',
	role: 'solo',
	groupId: 'default',
	fps: 60,
	temp: 51,
	uptime: 3600,
	crashCount: 0,
	lastError: 'aero-app[512]: TypeError: cannot read properties of undefined',
};

beforeEach(() => {
	vi.stubEnv('AERO_FLEET_TOKEN', TOKEN);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('POST /api/fleet/heartbeat', () => {
	it('accepts a valid heartbeat with the fleet token', async () => {
		const res = await post(SAMPLE, TOKEN);
		expect(res.status).toBe(200);
	});

	it('rejects a wrong token with 401', async () => {
		await expect(post(SAMPLE, 'nope')).rejects.toMatchObject({ status: 401 });
	});

	it('rejects a missing token with 401', async () => {
		await expect(post(SAMPLE)).rejects.toMatchObject({ status: 401 });
	});
});

describe('GET /api/fleet/heartbeat', () => {
	it('strips lastError from the latest-samples response', async () => {
		recordHeartbeat({ ...SAMPLE, mode: 'video' });
		const res = await get();
		const body = await res.json() as Array<Record<string, unknown>>;
		const mine = body.filter((s) => s.deviceId === 'pi-gw-1');
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ deviceId: 'pi-gw-1', fps: 60, temp: 51, mode: 'video' });
		expect('lastError' in mine[0]).toBe(false);
	});

	it('carries throttle bits and thermalAction for fleet health', async () => {
		// bit 2 = currently throttled
		recordHeartbeat({
			...SAMPLE,
			deviceId: 'pi-hot-1',
			temp: 82,
			throttledRaw: 0x4,
			thermalAction: 'shed',
		});
		const res = await get();
		const body = await res.json() as Array<Record<string, unknown>>;
		const mine = body.find((s) => s.deviceId === 'pi-hot-1');
		expect(mine).toMatchObject({
			temp: 82,
			throttledRaw: 4,
			thermalAction: 'shed',
		});
		const throttle = mine?.throttle as { throttled?: boolean; livePressure?: boolean } | undefined;
		expect(throttle?.throttled).toBe(true);
		expect(throttle?.livePressure).toBe(true);
	});

	it('strips lastError from the per-device history response', async () => {
		recordHeartbeat(SAMPLE);
		const res = await get('?deviceId=pi-gw-1');
		const body = await res.json() as Array<Record<string, unknown>>;
		expect(body.length).toBeGreaterThan(0);
		for (const s of body) {
			expect('lastError' in s).toBe(false);
		}
	});

	it('rejects a malformed deviceId with 400', async () => {
		await expect(get('?deviceId=bad host')).rejects.toMatchObject({ status: 400 });
	});

	it('summary rollup stays available without a token', async () => {
		recordHeartbeat(SAMPLE);
		const res = await get('?summary');
		const body = await res.json() as { total: number };
		expect(body.total).toBeGreaterThan(0);
	});
});

describe('apply-ack field (lastAppliedCommandId)', () => {
	// Unique deviceIds per case — the ring buffer is module-level and shared
	// across this file's tests.
	it('accepts and retains the apply-ack id', () => {
		const s = recordHeartbeat({ ...SAMPLE, deviceId: 'pi-ack-1', lastAppliedCommandId: 'mabc123-x7k2' });
		expect(s?.lastAppliedCommandId).toBe('mabc123-x7k2');
		const latest = latestAll().find((d) => d.deviceId === 'pi-ack-1');
		expect(latest?.lastAppliedCommandId).toBe('mabc123-x7k2');
		const stats = statsAll().find((d) => d.deviceId === 'pi-ack-1');
		expect(stats?.lastAppliedCommandId).toBe('mabc123-x7k2');
	});

	it('caps an over-long apply-ack id like the other hardening strings', () => {
		const s = recordHeartbeat({ ...SAMPLE, deviceId: 'pi-ack-2', lastAppliedCommandId: 'x'.repeat(500) });
		expect(s?.lastAppliedCommandId).toHaveLength(64);
	});

	it('drops non-string and empty apply-ack ids', () => {
		const numeric = recordHeartbeat({ ...SAMPLE, deviceId: 'pi-ack-3', lastAppliedCommandId: 42 });
		expect(numeric?.lastAppliedCommandId).toBeUndefined();
		const empty = recordHeartbeat({ ...SAMPLE, deviceId: 'pi-ack-3', lastAppliedCommandId: '' });
		expect(empty?.lastAppliedCommandId).toBeUndefined();
	});

	it('stays absent on heartbeats from older fielded builds', () => {
		const s = recordHeartbeat({ ...SAMPLE, deviceId: 'pi-ack-4' });
		expect(s?.lastAppliedCommandId).toBeUndefined();
	});
});
