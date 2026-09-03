import { describe, it, expect } from 'vitest';
import { isLoopback } from '#lib/server/loopback.js';

describe('isLoopback', () => {
	/**
	 * The IPv4-mapped form is the whole reason this exists: dialling
	 * 127.0.0.1 on a dual-stack socket reports '::ffff:127.0.0.1', so a naive
	 * equality check trusts `localhost` and refuses `127.0.0.1` — same machine,
	 * two answers.
	 */
	it('accepts all three spellings of this machine', () => {
		for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
			expect(isLoopback(a), a).toBe(true);
		}
	});

	it('refuses anything that merely looks loopback', () => {
		for (const a of [
			'127.0.0.2.evil.com',
			'::ffff:127.0.0.1.evil.com',
			'192.168.1.5',
			'10.0.0.1',
			'',
			' 127.0.0.1'
		]) {
			expect(isLoopback(a), a).toBe(false);
		}
	});
});
