/**
 * Per-device server-side status cache.
 *
 * Replaces the `devices` Map that lived in the WS hub. Each Pi's own
 * SvelteKit server keeps a cached DeviceStatus for itself — the browser
 * POSTs it to `/api/_status` on a timer (the same ~2s heartbeat rhythm
 * the WS path used). Admin dashboard polls `/api/status` and reads this
 * cache.
 *
 * Not distributed. Each Pi's registry only knows about ITSELF. The admin
 * panel enumerates peers via `/api/devices` (mDNS list from lan-peers)
 * and polls each peer's own `/api/status` directly.
 */

import type { LocationId, DisplayMode, WeatherType } from '$lib/types';

export interface DeviceStatus {
	deviceId: string;
	hostname: string;
	fps: number;
	mode: DisplayMode;
	location: LocationId;
	weather: WeatherType;
	uptime: number;
	lastSeen: number;
}

let cached: DeviceStatus | null = null;

export function setDeviceStatus(status: DeviceStatus): void {
	cached = { ...status, lastSeen: Date.now() };
}

export function getDeviceStatus(): DeviceStatus | null {
	return cached;
}
