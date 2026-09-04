import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readThermalState } from '#lib/server/thermal.js';
import { GET } from '../src/routes/api/internal/thermal/+server.js';

const dirs: string[] = [];
const withFile = (contents: string) => {
	const d = mkdtempSync(join(tmpdir(), 'aero-thermal-'));
	dirs.push(d);
	const p = join(d, 'thermal.json');
	writeFileSync(p, contents);
	return p;
};
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('readThermalState', () => {
	/**
	 * A 204 makes "thermal is fine" and "nothing is reporting thermal" render
	 * identically. Both absence cases must carry a reason a human can act on.
	 */
	it('reports absence with a reason, not silence', () => {
		const missing = readThermalState('/nope/thermal.json');
		expect(missing.state).toBeNull();
		expect(missing.reason).toContain('/nope/thermal.json');

		const junk = readThermalState(withFile('not json at all'));
		expect(junk.state).toBeNull();
		expect(junk.reason).toContain('unreadable');
	});

	it('reads a well-formed file', () => {
		const r = readThermalState(
			withFile(JSON.stringify({ tempC: 45, throttledRaw: '0x0', action: 'ok', updatedAtMs: 1 }))
		);
		expect(r.state).toMatchObject({ tempC: 45, action: 'ok', updatedAtMs: 1 });
	});

	/**
	 * The file's own `action` is an input to hysteresis, never the answer. A
	 * stale or hand-edited 'shed' on a cold Pi must not pin the wall in
	 * performance mode forever.
	 */
	it('re-derives the action instead of trusting the file', () => {
		const cold = readThermalState(
			withFile(JSON.stringify({ tempC: 20, throttledRaw: 0, action: 'shed' }))
		);
		expect(cold.state?.action).toBe('ok');

		const hot = readThermalState(
			withFile(JSON.stringify({ tempC: 95, throttledRaw: 0, action: 'ok' }))
		);
		expect(hot.state?.action).toBe('shed');
	});

	it('defaults missing numbers rather than emitting NaN', () => {
		const r = readThermalState(withFile('{}'));
		expect(r.state).toMatchObject({ tempC: 0, throttledRaw: 0, updatedAtMs: 0, action: 'ok' });
	});
});

describe('GET /api/internal/thermal', () => {
	const call = (addr: string) => GET({ getClientAddress: () => addr } as Parameters<typeof GET>[0]);

	it('answers loopback in all three spellings', async () => {
		for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
			expect((await call(a)).status, a).toBe(200);
		}
	});

	it('refuses anything else with 403', async () => {
		const res = await call('192.168.1.9');
		expect(res.status).toBe(403);
	});
});
