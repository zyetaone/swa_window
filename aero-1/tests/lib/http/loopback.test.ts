/**
 * Loopback detection — guards /api/status and /api/internal/token.
 *
 * The IPv4-mapped case is the whole point: Node reports '::ffff:127.0.0.1'
 * for an IPv4 client on a dual-stack socket, so a naive equality check
 * against '127.0.0.1' rejects the device's own browser depending only on
 * whether the kiosk URL says 127.0.0.1 or localhost.
 */
import { describe, it, expect } from 'vitest';
import { isLoopback } from '$lib/http/loopback';

describe('isLoopback', () => {
	it('accepts every loopback spelling', () => {
		expect(isLoopback('127.0.0.1')).toBe(true);
		expect(isLoopback('::1')).toBe(true);
		expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
	});

	it('rejects LAN and public addresses', () => {
		for (const addr of [
			'192.168.31.128',
			'10.0.0.5',
			'172.16.0.9',
			'8.8.8.8',
			'aero-display-01.local',
			'',
		]) {
			expect(isLoopback(addr)).toBe(false);
		}
	});

	it('does not accept look-alikes that merely start with a loopback prefix', () => {
		// A prefix/startsWith implementation would wrongly accept these.
		expect(isLoopback('127.0.0.1.evil.com')).toBe(false);
		expect(isLoopback('::ffff:127.0.0.1.evil.com')).toBe(false);
		expect(isLoopback('127.0.0.10')).toBe(false);
		expect(isLoopback(' 127.0.0.1')).toBe(false);
		expect(isLoopback('127.0.0.1, 8.8.8.8')).toBe(false);
	});
});
