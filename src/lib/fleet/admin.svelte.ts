/**
 * Admin Store — dual-transport fleet management state
 */

import type { DeviceInfo, DisplayConfig, ServerAdminMessage } from '$lib/fleet/protocol';
import { safeParse, type LocationId, type WeatherType, type DisplayMode } from '$lib/types';
import { createFleetTransport, type FleetTransport, type TransportState } from './transport.svelte';
import { resolveFleetUrl } from './url';

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

export class AdminStore {
	devices = $state<DeviceInfo[]>([]);
	transportType = $state<Transport>('ws');
	apiBase: string;
	fleetHealth = $state<FleetHealth>({ total: 0, online: 0, offline: 0, avgFps: 0, lowFpsCount: 0 });
	alerts = $state<HealthAlert[]>([]);
	serverUptime = $state(0);

	/** Reactive connection state — reads fall through to the underlying transport,
	 *  or 'disconnected' if no transport exists (pre-connect / post-destroy). */
	#transport: FleetTransport | null = null;
	#sse: EventSource | null = $state.raw(null);
	#sseState = $state<TransportState>('disconnected');
	#wsUrl: string;
	#healthInterval: ReturnType<typeof setInterval> | null = null;
	#destroyed = false;

	/** Current transport state — pass-through from the underlying FleetTransport
	 *  (or the SSE branch). Used by the admin page's connection badge. */
	get connectionState(): TransportState {
		if (this.transportType === 'ws') return this.#transport?.state ?? 'disconnected';
		return this.#sseState;
	}

	get isDestroyed(): boolean { return this.#destroyed; }

	constructor(serverUrl?: string, forceTransport?: Transport) {
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
		if (this.#destroyed) return;
		if (this.transportType === 'ws') this.#connectWs();
		else this.#connectSse();
	}

	disconnect(): void {
		this.#transport?.close();
		this.#transport = null;
		if (this.#sse) { this.#sse.close(); this.#sse = null; this.#sseState = 'disconnected'; }
	}

	#connectWs(): void {
		this.#transport = createFleetTransport({
			url: this.#wsUrl,
			autoReconnect: true,
			onMessage: (data) => this.#handleEvent(data),
		});
	}

	#connectSse(): void {
		try {
			this.#sseState = 'connecting';
			this.#sse = new EventSource(`${this.apiBase}/api/events`);
			this.#sse.onopen = () => { this.#sseState = 'connected'; };
			this.#sse.onerror = () => { this.#sseState = 'disconnected'; /* SSE auto-reconnects */ };
			this.#sse.onmessage = (e) => this.#handleEvent(e.data);
			this.#sse.addEventListener('device_registered', (e: MessageEvent) => this.#handleEvent(e.data));
			this.#sse.addEventListener('device_status', (e: MessageEvent) => this.#handleEvent(e.data));
			this.#sse.addEventListener('device_offline', (e: MessageEvent) => this.#handleEvent(e.data));
		} catch {
			this.#sseState = 'disconnected';
		}
	}

	#handleEvent(raw: string): void {
		const msg = safeParse<ServerAdminMessage>(raw);
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

	destroy(): void {
		this.#destroyed = true;
		this.disconnect();
		if (this.#healthInterval) {
			clearInterval(this.#healthInterval);
			this.#healthInterval = null;
		}
	}
}
