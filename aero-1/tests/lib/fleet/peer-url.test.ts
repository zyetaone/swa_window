/**
 * urlFor — peer URL construction SSOT used by both DeviceClient and
 * RestAdminStore. The behavior pinned here is the contract every cross-Pi
 * fetch relies on: self stays on the current page's origin (so non-default
 * dev ports + https stay intact), peers get a `<scheme>://host:port`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { urlFor } from '$lib/fleet/protocol';

const originalLocation = window.location;
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function stubLocation(origin: string, protocol: string) {
	Object.defineProperty(window, 'location', {
		value: { origin, protocol, hostname: 'unused' },
		writable: true,
		configurable: true,
	});
}

beforeEach(() => stubLocation('http://aero-display-00.local:5173', 'http:'));
afterEach(() => {
	Object.defineProperty(window, 'location', {
		value: originalLocation,
		writable: true,
		configurable: true,
	});
});

describe('urlFor', () => {
	it('returns window.location.origin for self peers', () => {
		expect(urlFor({ host: 'aero-display-00.local', port: 5173, self: true }))
			.toBe('http://aero-display-00.local:5173');
	});

	it('preserves the dev-server origin verbatim for self (port + scheme intact)', () => {
		stubLocation('https://kiosk-01.local:8443', 'https:');
		expect(urlFor({ host: 'irrelevant.local', port: 9999, self: true }))
			.toBe('https://kiosk-01.local:8443');
	});

	it('builds protocol://host:port for non-self peers', () => {
		expect(urlFor({ host: 'aero-display-01.local', port: 5173 }))
			.toBe('http://aero-display-01.local:5173');
	});

	it('uses the current page protocol for peers (https stays https)', () => {
		stubLocation('https://admin.local', 'https:');
		expect(urlFor({ host: 'aero-display-02.local', port: 443 }))
			.toBe('https://aero-display-02.local:443');
	});

	it('treats self=false the same as omitted', () => {
		const a = urlFor({ host: 'x.local', port: 80, self: false });
		const b = urlFor({ host: 'x.local', port: 80 });
		expect(a).toBe(b);
	});

	it('SSR-safe: with no window, falls back to http:// (best effort)', () => {
		// Simulate Node-only env by stripping window for the duration of the call.
		const savedWindow = globalThis.window;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		delete (globalThis as any).window;
		try {
			expect(urlFor({ host: 'aero.local', port: 5173 })).toBe('http://aero.local:5173');
			// Self in SSR has no window.location.origin to fall back to — it should
			// still produce a usable URL via the same path.
			expect(urlFor({ host: 'aero.local', port: 5173, self: true })).toBe('http://aero.local:5173');
		} finally {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(globalThis as any).window = savedWindow;
			if (originalDescriptor) Object.defineProperty(globalThis, 'window', originalDescriptor);
		}
	});
});
