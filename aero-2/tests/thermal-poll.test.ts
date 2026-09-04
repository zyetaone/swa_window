import { describe, it, expect, vi } from 'vitest';
import { createThermalPoller, THERMAL_POLL_MS } from '#lib/settings/thermal-poll.js';
import { THERMAL_SHED_TEMP_C, THERMAL_CLEAR_TEMP_C, type ThermalAction } from '#lib/throttle.js';

/**
 * The endpoint, the bitfield decoder, the hysteresis policy and the
 * health-check writer all existed and were tested, and nothing under
 * `display/` called any of them — while the route's docstring asserted "the
 * display polls this and sheds its own GPU work" as fact. These cover the
 * consumer that was missing.
 */
function sink() {
	let action: ThermalAction = 'ok';
	const seen: ThermalAction[] = [];
	return {
		get action() {
			return action;
		},
		setAction(a: ThermalAction) {
			action = a;
			seen.push(a);
		},
		seen
	};
}

const reply = (body: unknown, ok = true) =>
	vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

describe('thermal poller', () => {
	it('sheds when the device reports live throttling', async () => {
		const s = sink();
		const f = reply({
			state: { tempC: 55, throttledRaw: 4, flags: { livePressure: true }, action: 'shed' }
		});
		const p = createThermalPoller(s, f as unknown as typeof fetch);
		await p.poll();
		p.stop();
		expect(s.action).toBe('shed');
	});

	it('sheds on temperature alone, above the threshold', async () => {
		const s = sink();
		const f = reply({
			state: { tempC: THERMAL_SHED_TEMP_C + 1, throttledRaw: 0, flags: { livePressure: false } }
		});
		const p = createThermalPoller(s, f as unknown as typeof fetch);
		await p.poll();
		p.stop();
		expect(s.action).toBe('shed');
	});

	/**
	 * The hysteresis needs THIS pane's previous decision, which the server does
	 * not have — it has no memory of what any display is currently doing. So the
	 * action is recomputed locally rather than taken from the response.
	 */
	it('holds the shed through the hysteresis band, then clears', async () => {
		const s = sink();
		let temp = THERMAL_SHED_TEMP_C + 2;
		const f = vi.fn(
			async () =>
				({
					ok: true,
					json: async () => ({
						state: { tempC: temp, throttledRaw: 0, flags: { livePressure: false } }
					})
				}) as unknown as Response
		);
		const p = createThermalPoller(s, f as unknown as typeof fetch);
		await p.poll();
		expect(s.action).toBe('shed');

		// Inside the band: cooler than the shed point, warmer than the clear point.
		temp = THERMAL_CLEAR_TEMP_C + 1;
		await p.poll();
		expect(s.action, 'cleared inside the hysteresis band').toBe('shed');

		temp = THERMAL_CLEAR_TEMP_C - 1;
		await p.poll();
		expect(s.action).toBe('ok');
		p.stop();
	});

	/**
	 * Every failure resolves to 'ok', never to 'shed'. No thermal reporting is
	 * the NORMAL case off-Pi — dev machines, the smoke run, any install without
	 * health-check — and degrading the visuals everywhere because a file is
	 * absent would be a far worse regression than running hot on one device.
	 */
	it('stays ok when nothing is reporting', async () => {
		for (const body of [
			{ state: null, reason: 'no thermal state' },
			{},
			null,
			{ state: undefined }
		]) {
			const s = sink();
			const p = createThermalPoller(s, reply(body) as unknown as typeof fetch);
			await p.poll();
			p.stop();
			expect(s.action, `body ${JSON.stringify(body)} changed the action`).toBe('ok');
			expect(s.seen).toEqual([]);
		}
	});

	it('stays ok on a 403, a throw, or malformed JSON', async () => {
		const cases: (typeof fetch)[] = [
			reply({}, false) as unknown as typeof fetch,
			(async () => {
				throw new Error('offline');
			}) as unknown as typeof fetch,
			(async () => ({ ok: true, json: async () => 'not an object' })) as unknown as typeof fetch
		];
		for (const f of cases) {
			const s = sink();
			const p = createThermalPoller(s, f);
			await p.poll();
			p.stop();
			expect(s.action).toBe('ok');
		}
	});

	it('reports only on CHANGE, so a caller cannot thrash', async () => {
		const s = sink();
		const f = reply({
			state: { tempC: 90, throttledRaw: 0, flags: { livePressure: false } }
		});
		const p = createThermalPoller(s, f as unknown as typeof fetch);
		await p.poll();
		await p.poll();
		await p.poll();
		p.stop();
		expect(s.seen).toEqual(['shed']);
	});

	it('stops polling after stop()', async () => {
		const s = sink();
		const f = reply({ state: { tempC: 90, throttledRaw: 0, flags: { livePressure: true } } });
		const p = createThermalPoller(s, f as unknown as typeof fetch);
		p.stop();
		await p.poll();
		expect(s.action).toBe('ok');
	});

	it('polls slower than health-check writes, and no faster', () => {
		expect(THERMAL_POLL_MS).toBeGreaterThan(1000);
		expect(THERMAL_POLL_MS).toBeLessThanOrEqual(60_000);
	});
});
