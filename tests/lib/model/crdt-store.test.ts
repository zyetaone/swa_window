import { describe, it, expect, beforeEach } from 'vitest';
import { CRDTStore, setCRDTDeviceId, getCRDTDeviceId, type CRDTPatch } from '$lib/model/crdt-store';

// Timestamps above the 2024-01-01 sanity floor for readable relative ordering.
const T0 = 1704067200000; // MIN_SANE_TIMESTAMP
const T = (offset: number) => T0 + offset;

describe('CRDTStore', () => {
	let store: CRDTStore;
	let root: Record<string, unknown>;

	beforeEach(() => {
		setCRDTDeviceId('device-A');
		root = { a: 0, nested: { b: 0 } };
		store = new CRDTStore(root);
	});

	describe('canMerge', () => {
		it('returns true when path has no local write (no timestamp)', () => {
			const patch: CRDTPatch = { path: 'a', value: 1, timestamp: T(100), sourceId: 'device-B' };
			expect(store.canMerge(patch)).toBe(true);
		});

		it('strictly later timestamp wins', () => {
			store.merge({ path: 'a', value: 1, timestamp: T(100), sourceId: 'device-A' });
			expect(store.canMerge({ path: 'a', value: 2, timestamp: T(101), sourceId: 'device-B' })).toBe(true);
		});

		it('earlier timestamp loses regardless of sourceId', () => {
			store.merge({ path: 'a', value: 1, timestamp: T(100), sourceId: 'device-Z' });
			expect(store.canMerge({ path: 'a', value: 2, timestamp: T(99), sourceId: 'device-Z' })).toBe(false);
		});

		it('equal timestamps tie-break by sourceId (lexicographic greater wins)', () => {
			store.merge({ path: 'a', value: 1, timestamp: T(100), sourceId: 'device-A' });
			// device-B > device-A lexicographically, so it wins.
			expect(store.canMerge({ path: 'a', value: 2, timestamp: T(100), sourceId: 'device-B' })).toBe(true);
			// device-0 < device-A, so it loses.
			expect(store.canMerge({ path: 'a', value: 2, timestamp: T(100), sourceId: 'device-0' })).toBe(false);
		});

		it('rejects timestamps below sanity floor (dead RTC guard)', () => {
			// January 1 1970 — classic dead-RTC timestamp
			expect(store.canMerge({ path: 'a', value: 9, timestamp: 0, sourceId: 'device-B' })).toBe(false);
			// 2020 — before the floor
			expect(store.canMerge({ path: 'a', value: 9, timestamp: 1577836800000, sourceId: 'device-B' })).toBe(false);
		});
	});

	describe('merge', () => {
		it('applies value + timestamp + sourceId when winner', () => {
			const applied = store.merge({ path: 'a', value: 42, timestamp: T(100), sourceId: 'device-B' });
			expect(applied).toBe(true);
			expect(root.a).toBe(42);
			const entry = store.get('a');
			expect(entry).toEqual({ value: 42, timestamp: T(100), sourceId: 'device-B' });
		});

		it('is a no-op when loser', () => {
			store.merge({ path: 'a', value: 5, timestamp: T(200), sourceId: 'device-B' });
			const applied = store.merge({ path: 'a', value: 99, timestamp: T(150), sourceId: 'device-A' });
			expect(applied).toBe(false);
			expect(root.a).toBe(5);
			expect(store.get('a')!.value).toBe(5);
		});

		it('handles dotted paths via setByPath', () => {
			const applied = store.merge({ path: 'nested.b', value: 7, timestamp: T(100), sourceId: 'device-B' });
			expect(applied).toBe(true);
			expect((root.nested as Record<string, unknown>).b).toBe(7);
		});

		it('rejects merge with below-floor timestamp', () => {
			// Pre-seed with a legitimate write.
			store.merge({ path: 'a', value: 5, timestamp: T(200), sourceId: 'device-B' });
			// Attempt to overwrite with a 1970 timestamp — must fail.
			const applied = store.merge({ path: 'a', value: 99, timestamp: 0, sourceId: 'device-C' });
			expect(applied).toBe(false);
			expect(root.a).toBe(5);
		});
	});

	describe('set (local write)', () => {
		it('stamps with Date.now() and the registered deviceId', () => {
			const before = Date.now();
			store.set('a', 10);
			const after = Date.now();
			const entry = store.get('a')!;
			expect(entry.value).toBe(10);
			expect(entry.sourceId).toBe('device-A');
			expect(entry.timestamp).toBeGreaterThanOrEqual(before);
			expect(entry.timestamp).toBeLessThanOrEqual(after);
		});

		it('writes to root via setByPath', () => {
			store.set('nested.b', 99);
			expect((root.nested as Record<string, unknown>).b).toBe(99);
		});
	});

	describe('device id registry', () => {
		it('setCRDTDeviceId / getCRDTDeviceId roundtrip', () => {
			setCRDTDeviceId('pi-05');
			expect(getCRDTDeviceId()).toBe('pi-05');
		});
	});
});
