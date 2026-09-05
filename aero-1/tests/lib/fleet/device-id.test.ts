/**
 * resolveDeviceId — THE device-identity resolver (fleet + CF-Worker OTA).
 *
 * Pins the precedence contract: ?device= → stored aero-device-id →
 * hostname (non-localhost) → generated. Two divergent resolvers used to
 * share the storage key and only agreed by onMount source-order accident;
 * a split identity silently orphans the per-device OTA config queue from
 * the CRDT sourceId.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveDeviceId } from '$lib/fleet/device-id';

const KEY = 'aero-device-id';

function setUrl(search: string, hostname = 'localhost') {
	// happy-dom lets us drive location via history + defineProperty on hostname
	window.history.replaceState(null, '', `${search || '/'}`);
	Object.defineProperty(window.location, 'hostname', { value: hostname, configurable: true });
}

beforeEach(() => {
	localStorage.clear();
	setUrl('/');
});
afterEach(() => vi.restoreAllMocks());

describe('resolveDeviceId', () => {
	it('?device= wins and persists', () => {
		setUrl('/?device=left-pi');
		expect(resolveDeviceId()).toBe('left-pi');
		expect(localStorage.getItem(KEY)).toBe('left-pi');
	});

	it('?device= overwriting a DIFFERENT stored id warns (spoof/reassignment signal)', () => {
		localStorage.setItem(KEY, 'display-old');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		setUrl('/?device=display-new');
		expect(resolveDeviceId()).toBe('display-new');
		expect(warn).toHaveBeenCalledOnce();
	});

	it('stored id wins over hostname when no URL param', () => {
		localStorage.setItem(KEY, 'display-stable');
		setUrl('/', 'aero-display-04.local');
		expect(resolveDeviceId()).toBe('display-stable');
	});

	it('non-localhost hostname is adopted and persisted when nothing stored', () => {
		setUrl('/', 'aero-display-04.local');
		expect(resolveDeviceId()).toBe('aero-display-04.local');
		expect(localStorage.getItem(KEY)).toBe('aero-display-04.local');
	});

	it('generates + persists a display-* id on localhost with nothing stored', () => {
		const id = resolveDeviceId();
		expect(id).toMatch(/^display-/);
		expect(localStorage.getItem(KEY)).toBe(id);
		// stable across calls
		expect(resolveDeviceId()).toBe(id);
	});
});
