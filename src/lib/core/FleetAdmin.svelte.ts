/**
 * Admin Store — dual-transport fleet management state
 */

import type { DeviceInfo, LocationId, WeatherType, DisplayMode, DisplayConfig } from '$lib/shared';
import { BaseTransport } from './BaseTransport';

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

	private ws: WebSocket | null = $state.raw(null);
	private sse: EventSource | null = $state.raw(null);
	private wsUrl: string;
	private healthInterval: ReturnType<typeof setInterval> | null = null;

	constructor(serverUrl?: string, forceTransport?: Transport) {
		super();
		this.wsUrl = serverUrl || `ws://${window.location.hostname}:3001/ws?role=admin`;
		this.apiBase = this.wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws.*$/, '');

		if (forceTransport) {
			this.transportType = forceTransport;
		} else if (typeof window !== 'undefined') {
			const serverHost = new URL(this.apiBase).hostname;
			const isSameHost = serverHost === window.location.hostname || serverHost === 'localhost';
			this.transportType = isSameHost ? 'ws' : 'sse';
		}

		this.connect();
		this.fetchDevices();
		this.startHealthPolling();
	}

	connect(): void {
		if (this.destroyed) return;
		if (this.transportType === 'ws') this.connectWs();
		else this.connectSse();
	}

	disconnect(): void {
		if (this.ws) { this.ws.close(); this.ws = null; }
		if (this.sse) { this.sse.close(); this.sse = null; }
	}

	private connectWs(): void {
		try {
			this.ws = new WebSocket(this.wsUrl);
			this.ws.onopen = () => this.onConnected();
			this.ws.onclose = () => this.onDisconnected();
			this.ws.onmessage = (e) => this.handleEvent(e.data);
		} catch {
			this.onDisconnected();
		}
	}

	private connectSse(): void {
		try {
			this.sse = new EventSource(`${this.apiBase}/api/events`);
			this.sse.onopen = () => this.onConnected();
			this.sse.onerror = () => {
				this.state = 'disconnected'; 
				// EventSource auto-reconnects, so we don't call onDisconnected()
				// which would trigger our manual reconnect timer.
			};
			this.sse.onmessage = (e) => this.handleEvent(e.data);
			this.sse.addEventListener('device_registered', (e) => this.handleEvent(e.data));
			this.sse.addEventListener('device_status', (e) => this.handleEvent(e.data));
			this.sse.addEventListener('device_offline', (e) => this.handleEvent(e.data));
		} catch {
			this.onDisconnected();
		}
	}

	private handleEvent(raw: string): void {
		let msg: any;
		try { msg = JSON.parse(raw); } catch { return; }
		switch (msg.type) {
			case 'device_registered': this.upsertDevice(msg.device); break;
			case 'device_status': this.updateDeviceStatus(msg.deviceId, msg); break;
			case 'device_offline': this.markOffline(msg.deviceId); break;
		}
	}

	// ... rest of the status/health logic (omitted for brevity in prompt, but I'll write the full file)
	// I'll copy the remaining methods from my previous view_file.

	private upsertDevice(device: DeviceInfo): void {
		const idx = this.devices.findIndex(d => d.deviceId === device.deviceId);
		if (idx >= 0) this.devices[idx] = device;
		else this.devices = [...this.devices, device];
	}

	private updateDeviceStatus(deviceId: string, status: any): void {
		const device = this.devices.find(d => d.deviceId === deviceId);
		if (device) {
			device.fps = status.fps;
			device.currentMode = status.mode;
			device.currentLocation = status.location as LocationId;
			device.uptime = status.uptime;
			device.online = true;
			device.lastSeen = Date.now();
			this.devices = [...this.devices];
		}
	}

	private markOffline(deviceId: string): void {
		const device = this.devices.find(d => d.deviceId === deviceId);
		if (device) {
			device.online = false;
			this.devices = [...this.devices];
		}
	}

	private async fetchDevices(): Promise<void> {
		try {
			const res = await fetch(`${this.apiBase}/api/devices`);
			if (res.ok) this.devices = await res.json();
		} catch {}
	}

	private startHealthPolling(): void {
		const poll = async () => {
			try {
				const res = await fetch(`${this.apiBase}/api/health`);
				if (res.ok) {
					const data = await res.json();
					this.fleetHealth = data.fleet;
					this.alerts = data.alerts;
					this.serverUptime = data.serverUptime;
				}
			} catch {}
		};
		poll();
		this.healthInterval = setInterval(poll, 10000);
	}

	async pushScene(deviceId: string, location: LocationId, weather?: WeatherType) {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}

	async pushMode(deviceId: string, mode: DisplayMode, payload?: string) {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/mode`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode, payload }),
		});
	}

	async pushConfig(deviceId: string, config: DisplayConfig) {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/config`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		});
	}

	async broadcastScene(location: LocationId, weather?: WeatherType) {
		await fetch(`${this.apiBase}/api/broadcast/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}
}
