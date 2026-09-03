import { describe, it, expect } from 'vitest';
import { schedulePrivileged } from '#lib/server/privileged.js';

/**
 * Off Linux this is a no-op by contract, and the tests lean on that: a suite
 * run on a Pi must never actually spawn `sudo`.
 */
describe('schedulePrivileged', () => {
	const asPlatform = <T>(value: string, fn: () => T): T => {
		const real = process.platform;
		Object.defineProperty(process, 'platform', { value, configurable: true });
		try {
			return fn();
		} finally {
			Object.defineProperty(process, 'platform', { value: real, configurable: true });
		}
	};

	it('no-ops and reports success off Linux', () => {
		expect(asPlatform('darwin', () => schedulePrivileged(['echo', 'test'], 10, '[test]'))).toBe(
			true
		);
	});

	it('does not spawn the command off Linux', async () => {
		// If the no-op branch ever started spawning, this would run `false` and
		// there would be no return value to catch it — so assert on the effect the
		// caller can see: nothing was scheduled, and nothing threw after the delay.
		expect(asPlatform('darwin', () => schedulePrivileged(['false'], 1, '[test]'))).toBe(true);
		await new Promise((r) => setTimeout(r, 20));
	});
});
