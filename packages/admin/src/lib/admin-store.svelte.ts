/**
 * Admin Store — manages WebSocket connection to server + device state
 *
 * Provides reactive device list, connection status, and methods to
 * push scenes/modes/configs to individual or all displays.
 */

import type { DeviceInfo, LocationId, WeatherType, DisplayMode, DisplayConfig } from '@zyeta/shared';

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
	connected = $state(false);
	readonly serverUrl: string;
	readonly apiBase: string;
	fleetHealth = $state<FleetHealth>({ total: 0, online: 0, offline: 0, avgFps: 0, lowFpsCount: 0 });
	alerts = $state<HealthAlert[]>([]);
	serverUptime = $state(0);
	private ws: WebSocket | null = null;
	private healthInterval: ReturnType<typeof setInterval> | null = null;

	constructor(serverUrl?: string) {
		this.serverUrl = serverUrl || `ws://${window.location.hostname}:3001/ws?role=admin`;
		this.apiBase = this.serverUrl
			.replace(/^ws(s?):\/\//, 'http$1://')
			.replace(/\/ws.*$/, '');
		this.connect();
		this.fetchDevices();
		this.startHealthPolling();
	}

	private connect(): void {
		try {
			this.ws = new WebSocket(this.serverUrl);
			this.ws.onopen = () => { this.connected = true; };
			this.ws.onclose = () => {
				this.connected = false;
				setTimeout(() => this.connect(), 3000);
			};
			this.ws.onmessage = (e) => this.handleMessage(e.data);
			this.ws.onerror = () => { /* onclose will fire */ };
		} catch {
			setTimeout(() => this.connect(), 3000);
		}
	}

	private handleMessage(raw: string): void {
		let msg: Record<string, unknown>;
		try { msg = JSON.parse(raw); } catch { return; }
		switch (msg.type) {
			case 'device_registered':
				this.upsertDevice(msg.device as DeviceInfo);
				break;
			case 'device_status':
				this.updateDeviceStatus(
					msg.deviceId as string,
					msg as unknown as { fps: number; mode: DisplayMode; location: string; uptime: number },
				);
				break;
			case 'device_offline':
				this.markOffline(msg.deviceId as string);
				break;
		}
	}

	private upsertDevice(device: DeviceInfo): void {
		const idx = this.devices.findIndex(d => d.deviceId === device.deviceId);
		if (idx >= 0) {
			this.devices[idx] = device;
		} else {
			this.devices = [...this.devices, device];
		}
	}

	private updateDeviceStatus(deviceId: string, status: { fps: number; mode: DisplayMode; location: string; uptime: number }): void {
		const device = this.devices.find(d => d.deviceId === deviceId);
		if (device) {
			device.fps = status.fps;
			device.currentMode = status.mode;
			device.currentLocation = status.location as LocationId;
			device.uptime = status.uptime;
			device.online = true;
			device.lastSeen = Date.now();
			this.devices = [...this.devices]; // trigger reactivity
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
			const apiBase = this.apiBase;
			const res = await fetch(`${apiBase}/api/devices`);
			if (res.ok) {
				this.devices = (await res.json()) as DeviceInfo[];
			}
		} catch { /* server not available yet */ }
	}

	private startHealthPolling(): void {
		const poll = async () => {
			try {
				const apiBase = this.apiBase;
				const res = await fetch(`${apiBase}/api/health`);
				if (res.ok) {
					const data = await res.json() as {
						serverUptime: number;
						fleet: FleetHealth;
						alerts: HealthAlert[];
					};
					this.fleetHealth = data.fleet;
					this.alerts = data.alerts;
					this.serverUptime = data.serverUptime;
				}
			} catch { /* server not available */ }
		};
		poll();
		this.healthInterval = setInterval(poll, 10_000);
	}

	// ========================================================================
	// ACTIONS
	// ========================================================================

	async pushScene(deviceId: string, location: LocationId, weather?: WeatherType): Promise<void> {
		const apiBase = this.apiBase;
		await fetch(`${apiBase}/api/devices/${deviceId}/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}

	async pushMode(deviceId: string, mode: DisplayMode, payload?: string): Promise<void> {
		const apiBase = this.apiBase;
		await fetch(`${apiBase}/api/devices/${deviceId}/mode`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode, payload }),
		});
	}

	async pushConfig(deviceId: string, config: DisplayConfig): Promise<void> {
		const apiBase = this.apiBase;
		await fetch(`${apiBase}/api/devices/${deviceId}/config`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		});
	}

	async broadcastScene(location: LocationId, weather?: WeatherType): Promise<void> {
		const apiBase = this.apiBase;
		await fetch(`${apiBase}/api/broadcast/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}

	destroy(): void {
		this.ws?.close();
		this.ws = null;
		if (this.healthInterval) {
			clearInterval(this.healthInterval);
			this.healthInterval = null;
		}
	}
}
