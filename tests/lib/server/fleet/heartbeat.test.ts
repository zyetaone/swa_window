import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The store reads AERO_HEARTBEAT_LOG at import time, so each test stubs the
// env and re-imports fresh (vi.resetModules).
describe('heartbeat JSONL persistence', () => {
	let dir: string;
	let log: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'aero-hb-'));
		log = join(dir, 'hb.jsonl');
		vi.stubEnv('AERO_HEARTBEAT_LOG', log);
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	it('appends each recorded sample as one JSON line', async () => {
		const { recordHeartbeat } = await import('$lib/server/fleet/heartbeat');
		recordHeartbeat({ deviceId: 'pi-1', fps: 60, temp: 50, uptime: 100, crashCount: 0 });
		const lines = readFileSync(log, 'utf8').trim().split('\n');
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]).deviceId).toBe('pi-1');
	});

	it('re-seeds ring buffers from the log tail on fresh import (survives restart)', async () => {
		let mod = await import('$lib/server/fleet/heartbeat');
		mod.recordHeartbeat({ deviceId: 'pi-2', fps: 55, temp: 51, uptime: 200, crashCount: 1 });
		vi.resetModules();
		mod = await import('$lib/server/fleet/heartbeat');
		const all = mod.latestAll();
		expect(all.some((s) => s.deviceId === 'pi-2' && s.fps === 55)).toBe(true);
	});

	it('never writes when the log path is disabled', async () => {
		vi.stubEnv('AERO_HEARTBEAT_LOG', '');
		vi.resetModules();
		const { recordHeartbeat } = await import('$lib/server/fleet/heartbeat');
		recordHeartbeat({ deviceId: 'pi-3', fps: 60, temp: 50, uptime: 10, crashCount: 0 });
		expect(existsSync(log)).toBe(false);
	});
});
