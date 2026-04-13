/**
 * Admin Store — dual-transport fleet management state
 */

import type { DeviceInfo, DisplayConfig } from '$lib/fleet/protocol';
import type { LocationId, WeatherType, DisplayMode } from '$lib/types';
import { BaseTransport } from './transport.svelte';
import { resolveFleetUrl } from './url';
import { safeParse } from '$lib/validation';

export type Transport = 'ws' | 'sse';

export interface FleetHealth {
	total: number;
	online: number;
	offline: number;
	avgFps: number;
	lowFpsCount: number;
}

export interface HealthAlert {
	level: 'error' | 'warning';
	device: string;
	message: string;
}

export class AdminStore extends BaseTransport {
	devices = $state<DeviceInfo[]>([]);
	transportType = $state<Transport>('ws');
	apiBase: string;
	fleetHealth = $state<FleetHealth>({ total: 0, online: 0, offline: 0, avgFps: 0, lowFpsCount: 0 });
	alerts = $state<HealthAlert[]>([]);
	serverUptime = $state(0);

	#ws: WebSocket | null = $state.raw(null);
	#sse: EventSource | null = $state.raw(null);
	#wsUrl: string;
	#healthInterval: ReturnType<typeof setInterval> | null = null;

	constructor(serverUrl?: string, forceTransport?: Transport) {
		super();
		const endpoint = resolveFleetUrl('admin', serverUrl);
		this.#wsUrl = endpoint.wsUrl;
		this.apiBase = endpoint.apiBase;

		if (forceTransport) {
			this.transportType = forceTransport;
		} else if (typeof window !== 'undefined') {
			const serverHost = new URL(this.apiBase).hostname;
			const isSameHost = serverHost === window.location.hostname || serverHost === 'localhost';
			this.transportType = isSameHost ? 'ws' : 'sse';
		}

		this.connect();
		this.#fetchDevices();
		this.#startHealthPolling();
	}

	connect(): void {
		if (this.isDestroyed) return;
		if (this.transportType === 'ws') this.#connectWs();
		else this.#connectSse();
	}

	disconnect(): void {
		if (this.#ws) { this.#ws.close(); this.#ws = null; }
		if (this.#sse) { this.#sse.close(); this.#sse = null; }
	}

	#connectWs(): void {
		try {
			this.#ws = new WebSocket(this.#wsUrl);
			this.#ws.onopen = () => this.onConnected();
			this.#ws.onclose = () => this.onDisconnected();
			this.#ws.onmessage = (e) => this.#handleEvent(e.data);
		} catch {
			this.onDisconnected();
		}
	}

	#connectSse(): void {
		try {
			this.#sse = new EventSource(`${this.apiBase}/api/events`);
			this.#sse.onopen = () => this.onConnected();
			this.#sse.onerror = () => {
				this.onDisconnected(false); // SSE auto-reconnects
			};
			this.#sse.onmessage = (e) => this.#handleEvent(e.data);
			this.#sse.addEventListener('device_registered', (e: MessageEvent) => this.#handleEvent(e.data));
			this.#sse.addEventListener('device_status', (e: MessageEvent) => this.#handleEvent(e.data));
			this.#sse.addEventListener('device_offline', (e: MessageEvent) => this.#handleEvent(e.data));
		} catch {
			this.onDisconnected();
		}
	}

	#handleEvent(raw: string): void {
		const msg = safeParse<any>(raw);
		if (!msg) return;
		switch (msg.type) {
			case 'device_registered': this.#upsertDevice(msg.device); break;
			case 'device_status': this.#updateDeviceStatus(msg.deviceId, msg); break;
			case 'device_offline': this.#markOffline(msg.deviceId); break;
		}
	}

	#upsertDevice(device: DeviceInfo): void {
		const idx = this.devices.findIndex(d => d.deviceId === device.deviceId);
		if (idx >= 0) this.devices[idx] = device;
		else this.devices = [...this.devices, device];
	}

	#updateDeviceStatus(deviceId: string, status: any): void {
		let device = this.devices.find(d => d.deviceId === deviceId);
		if (!device) {
			device = {
				deviceId,
				hostname: deviceId,
				capabilities: {} as any,
				currentMode: status.mode ?? 'flight',
				currentLocation: (status.location ?? 'dubai') as LocationId,
				fps: 0,
				uptime: 0,
				lastSeen: Date.now(),
				online: true,
			};
			this.devices = [...this.devices, device];
		}
		device.fps = status.fps;
		device.currentMode = status.mode;
		device.currentLocation = status.location as LocationId;
		device.uptime = status.uptime;
		device.online = true;
		device.lastSeen = Date.now();
		this.devices = [...this.devices];
	}

	#markOffline(deviceId: string): void {
		const device = this.devices.find(d => d.deviceId === deviceId);
		if (device) {
			device.online = false;
			this.devices = [...this.devices];
		}
	}

	async #request<T = unknown>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T | null> {
		try {
			const res = await fetch(`${this.apiBase}${path}`, {
				method,
				...(body !== undefined && {
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				}),
			});
			if (!res.ok) { console.warn(`[FleetAdmin] ${method} ${path}: ${res.status}`); return null; }
			return method === 'GET' ? await res.json() : null;
		} catch (e) { console.warn(`[FleetAdmin] ${method} ${path} network error:`, e); return null; }
	}

	async #fetchDevices(): Promise<void> {
		const data = await this.#request<DeviceInfo[]>('/api/devices');
		if (data) this.devices = data;
	}

	#startHealthPolling(): void {
		const poll = async () => {
			const data = await this.#request<{ fleet: FleetHealth; alerts: HealthAlert[]; serverUptime: number }>('/api/health');
			if (data) {
				this.fleetHealth = data.fleet;
				this.alerts = data.alerts;
				this.serverUptime = data.serverUptime;
			}
		};
		poll();
		this.#healthInterval = setInterval(poll, 10000);
	}

	async pushScene(deviceId: string, location: LocationId, weather?: WeatherType) {
		await this.#request(`/api/devices/${deviceId}/scene`, 'POST', { location, weather });
	}

	async pushMode(deviceId: string, mode: DisplayMode, payload?: string) {
		await this.#request(`/api/devices/${deviceId}/mode`, 'POST', { mode, payload });
	}

	async pushConfig(deviceId: string, config: DisplayConfig) {
		await this.#request(`/api/devices/${deviceId}/config`, 'POST', config);
	}

	async broadcastScene(location: LocationId, weather?: WeatherType) {
		await this.#request('/api/broadcast/scene', 'POST', { location, weather });
	}

	override destroy(): void {
		super.destroy();
		if (this.#healthInterval) {
			clearInterval(this.#healthInterval);
			this.#healthInterval = null;
		}
	}
}
