/**
 * Admin Store — dual-transport fleet management state
 *
 * Supports two push transports (auto-detected):
 *   - WebSocket: for local admin (same machine, lowest latency)
 *   - SSE: for remote admin (proxy/CDN friendly, auto-reconnect)
 *
 * Commands always go via REST (both transports).
 * Transport is chosen by URL param: ?transport=sse or ?transport=ws
 * Default: auto-detect (same-origin → WS, cross-origin → SSE)
 */

import type { DeviceInfo, LocationId, WeatherType, DisplayMode, DisplayConfig } from '@zyeta/shared';

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
	connected = $state(false);
	transport = $state<Transport>('ws');
	readonly apiBase: string;
	fleetHealth = $state<FleetHealth>({ total: 0, online: 0, offline: 0, avgFps: 0, lowFpsCount: 0 });
	alerts = $state<HealthAlert[]>([]);
	serverUptime = $state(0);

	private ws: WebSocket | null = null;
	private sse: EventSource | null = null;
	private healthInterval: ReturnType<typeof setInterval> | null = null;

	constructor(serverUrl?: string, forceTransport?: Transport) {
		// Derive API base from server URL or default to same-host :3001
		const wsUrl = serverUrl || `ws://${window.location.hostname}:3001/ws?role=admin`;
		this.apiBase = wsUrl
			.replace(/^ws(s?):\/\//, 'http$1://')
			.replace(/\/ws.*$/, '');

		// Auto-detect transport: same hostname → WS, different → SSE
		if (forceTransport) {
			this.transport = forceTransport;
		} else {
			const serverHost = new URL(this.apiBase).hostname;
			const isSameHost = serverHost === window.location.hostname || serverHost === 'localhost' || serverHost === '127.0.0.1';
			this.transport = isSameHost ? 'ws' : 'sse';
		}

		console.info(`[admin] Transport: ${this.transport}, API: ${this.apiBase}`);

		if (this.transport === 'ws') {
			this.connectWs(wsUrl);
		} else {
			this.connectSse();
		}

		this.fetchDevices();
		this.startHealthPolling();
	}

	// ========================================================================
	// WEBSOCKET TRANSPORT (local admin)
	// ========================================================================

	private connectWs(url: string): void {
		try {
			this.ws = new WebSocket(url);
			this.ws.onopen = () => { this.connected = true; };
			this.ws.onclose = () => {
				this.connected = false;
				setTimeout(() => this.connectWs(url), 3000);
			};
			this.ws.onmessage = (e) => this.handleEvent(e.data);
			this.ws.onerror = () => { /* onclose will fire */ };
		} catch {
			setTimeout(() => this.connectWs(url), 3000);
		}
	}

	// ========================================================================
	// SSE TRANSPORT (remote admin)
	// ========================================================================

	private connectSse(): void {
		const sseUrl = `${this.apiBase}/api/events`;
		console.info(`[admin] SSE connecting to ${sseUrl}`);

		this.sse = new EventSource(sseUrl);

		this.sse.onopen = () => {
			this.connected = true;
		};

		this.sse.onerror = () => {
			this.connected = false;
			// EventSource auto-reconnects — no manual retry needed
		};

		// Named event listeners (match SSE event: field from server)
		this.sse.addEventListener('device_registered', (e: MessageEvent) => {
			this.handleEvent(e.data);
		});

		this.sse.addEventListener('device_status', (e: MessageEvent) => {
			this.handleEvent(e.data);
		});

		this.sse.addEventListener('device_offline', (e: MessageEvent) => {
			this.handleEvent(e.data);
		});

		// Fallback: unnamed events (data-only, no event: field)
		this.sse.onmessage = (e: MessageEvent) => {
			this.handleEvent(e.data);
		};
	}

	// ========================================================================
	// SHARED EVENT HANDLING
	// ========================================================================

	private handleEvent(raw: string): void {
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
			if (res.ok) this.devices = (await res.json()) as DeviceInfo[];
		} catch { /* server not available yet */ }
	}

	private startHealthPolling(): void {
		const poll = async () => {
			try {
				const res = await fetch(`${this.apiBase}/api/health`);
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
	// ACTIONS (always REST — works with both transports)
	// ========================================================================

	async pushScene(deviceId: string, location: LocationId, weather?: WeatherType): Promise<void> {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}

	async pushMode(deviceId: string, mode: DisplayMode, payload?: string): Promise<void> {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/mode`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode, payload }),
		});
	}

	async pushConfig(deviceId: string, config: DisplayConfig): Promise<void> {
		await fetch(`${this.apiBase}/api/devices/${deviceId}/config`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(config),
		});
	}

	async broadcastScene(location: LocationId, weather?: WeatherType): Promise<void> {
		await fetch(`${this.apiBase}/api/broadcast/scene`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ location, weather }),
		});
	}

	destroy(): void {
		this.ws?.close();
		this.ws = null;
		this.sse?.close();
		this.sse = null;
		if (this.healthInterval) {
			clearInterval(this.healthInterval);
			this.healthInterval = null;
		}
	}
}
