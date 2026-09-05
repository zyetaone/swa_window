/**
 * fanOut — admin fleet action tally.
 *
 * The regression under test: three admin handlers reported failures with
 * `results.filter(r => !r.ok).map((r, i) => targets[i])`, where `i` indexes
 * the FILTERED array. A dashboard that names the wrong Pi sends an operator
 * to physically check a device that is fine while the broken one looks OK.
 */
import { describe, it, expect } from 'vitest';
import { fanOut } from '$lib/fleet/fan-out';

const T = ['pi-aaaaaaaa', 'pi-bbbbbbbb', 'pi-cccccccc'];

describe('fanOut', () => {
	it('attributes failures to the device that actually failed', async () => {
		// First succeeds, last two fail — the exact shape the old index-after-
		// filter bug mis-reported as the FIRST two devices failing.
		const res = await fanOut(T, async (id) => {
			if (id !== T[0]) throw new Error('boom');
		});

		expect(res.ok).toBe(1);
		expect(res.failed).toEqual(['pi-bbbbb: boom', 'pi-ccccc: boom']);
		expect(res.failed.some((f) => f.startsWith('pi-aaaaa'))).toBe(false);
	});

	it('counts every success when all succeed', async () => {
		const res = await fanOut(T, async () => {});
		expect(res).toEqual({ ok: 3, failed: [] });
	});

	it('reports all failures when all fail', async () => {
		const res = await fanOut(T, async () => { throw new Error('down'); });
		expect(res.ok).toBe(0);
		expect(res.failed).toHaveLength(3);
	});

	it('preserves target order in the failure list', async () => {
		const res = await fanOut(T, async (id) => {
			if (id === T[1]) return;           // middle one succeeds
			throw new Error('x');
		});
		expect(res.failed).toEqual(['pi-aaaaa: x', 'pi-ccccc: x']);
	});

	it('handles an empty target list', async () => {
		expect(await fanOut([], async () => {})).toEqual({ ok: 0, failed: [] });
	});

	it('runs targets concurrently, not serially', async () => {
		let live = 0;
		let peak = 0;
		await fanOut(T, async () => {
			live++; peak = Math.max(peak, live);
			await new Promise((r) => setTimeout(r, 5));
			live--;
		});
		expect(peak).toBe(3);
	});

	it('stringifies non-Error throws', async () => {
		const res = await fanOut([T[0]], async () => { throw 'plain string'; });
		expect(res.failed[0]).toContain('plain string');
	});
});
