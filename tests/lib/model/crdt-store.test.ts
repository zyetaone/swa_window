import { describe, it, expect, beforeEach } from 'vitest';
import { CRDTStore, setCRDTDeviceId, getCRDTDeviceId, type CRDTPatch } from '$lib/model/crdt-store';

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
			const patch: CRDTPatch = { path: 'a', value: 1, timestamp: 100, sourceId: 'device-B' };
			expect(store.canMerge(patch)).toBe(true);
		});

		it('strictly later timestamp wins', () => {
			store.merge({ path: 'a', value: 1, timestamp: 100, sourceId: 'device-A' });
			expect(store.canMerge({ path: 'a', value: 2, timestamp: 101, sourceId: 'device-B' })).toBe(true);
		});

		it('earlier timestamp loses regardless of sourceId', () => {
			store.merge({ path: 'a', value: 1, timestamp: 100, sourceId: 'device-Z' });
			expect(store.canMerge({ path: 'a', value: 2, timestamp: 99, sourceId: 'device-Z' })).toBe(false);
		});

		it('equal timestamps tie-break by sourceId (lexicographic greater wins)', () => {
			store.merge({ path: 'a', value: 1, timestamp: 100, sourceId: 'device-A' });
			// device-B > device-A lexicographically, so it wins.
			expect(store.canMerge({ path: 'a', value: 2, timestamp: 100, sourceId: 'device-B' })).toBe(true);
			// device-0 < device-A, so it loses.
			expect(store.canMerge({ path: 'a', value: 2, timestamp: 100, sourceId: 'device-0' })).toBe(false);
		});
	});

	describe('merge', () => {
		it('applies value + timestamp + sourceId when winner', () => {
			const applied = store.merge({ path: 'a', value: 42, timestamp: 100, sourceId: 'device-B' });
			expect(applied).toBe(true);
			expect(root.a).toBe(42);
			const entry = store.get('a');
			expect(entry).toEqual({ value: 42, timestamp: 100, sourceId: 'device-B' });
		});

		it('is a no-op when loser', () => {
			store.merge({ path: 'a', value: 5, timestamp: 200, sourceId: 'device-B' });
			const applied = store.merge({ path: 'a', value: 99, timestamp: 150, sourceId: 'device-A' });
			expect(applied).toBe(false);
			expect(root.a).toBe(5);
			expect(store.get('a')!.value).toBe(5);
		});

		it('handles dotted paths via setByPath', () => {
			const applied = store.merge({ path: 'nested.b', value: 7, timestamp: 100, sourceId: 'device-B' });
			expect(applied).toBe(true);
			expect((root.nested as Record<string, unknown>).b).toBe(7);
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
