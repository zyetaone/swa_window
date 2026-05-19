import { describe, it, expect } from 'vitest';
import {
	getDeviceStatus,
	setDeviceStatus,
	type DeviceStatus,
} from '$lib/fleet/device-registry.server';

function sample(overrides: Partial<DeviceStatus> = {}): DeviceStatus {
	return {
		deviceId: 'test-device',
		hostname: 'test.local',
		fps: 60,
		mode: 'flight',
		location: 'dubai',
		weather: 'clear',
		uptime: 120,
		lastSeen: 0,
		...overrides,
	};
}

describe('device-registry', () => {
	it('roundtrips set → get with current Date.now() as lastSeen', () => {
		const before = Date.now();
		setDeviceStatus(sample({ fps: 45 }));
		const after = Date.now();
		const status = getDeviceStatus();
		expect(status).not.toBeNull();
		expect(status!.fps).toBe(45);
		expect(status!.lastSeen).toBeGreaterThanOrEqual(before);
		expect(status!.lastSeen).toBeLessThanOrEqual(after);
	});

	it('second set overwrites the first', () => {
		setDeviceStatus(sample({ fps: 30, location: 'mumbai' }));
		setDeviceStatus(sample({ fps: 60, location: 'dallas' }));
		const status = getDeviceStatus();
		expect(status!.fps).toBe(60);
		expect(status!.location).toBe('dallas');
	});

	it('setDeviceStatus overrides any lastSeen the caller passed', () => {
		setDeviceStatus(sample({ lastSeen: 12345 }));
		const status = getDeviceStatus();
		// Implementation stamps Date.now() regardless of what the caller put
		// in lastSeen — that field is meant as a cache freshness timestamp,
		// not something the browser reports. Protect that invariant.
		expect(status!.lastSeen).not.toBe(12345);
	});
});
