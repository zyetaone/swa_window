/**
 * WebSocket Client — connects display to fleet management server
 *
 * Auto-connects on boot, sends register + periodic status messages,
 * handles incoming commands (set_mode, set_scene, set_config).
 * Auto-reconnects with exponential backoff on disconnect.
 */

import type { ServerMessage, DisplayMessage, DeviceCaps } from '@zyeta/shared';
import type { WindowModel } from './WindowModel.svelte';

// ============================================================================
// DEVICE IDENTITY
// ============================================================================

function getDeviceId(): string {
	// Allow explicit device name from URL param (?device=aero-display-lobby)
	const urlDeviceId = new URLSearchParams(window.location.search).get('device');
	if (urlDeviceId) {
		localStorage.setItem('aero-device-id', urlDeviceId);
		return urlDeviceId;
	}

	const key = 'aero-device-id';
	let id = localStorage.getItem(key);
	if (!id) {
		id = `display-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		localStorage.setItem(key, id);
	}
	return id;
}

function getDeviceCaps(): DeviceCaps {
	const canvas = document.createElement('canvas');
	const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
	const renderer = gl
		? (gl.getExtension('WEBGL_debug_renderer_info')
			? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL)
			: 'Unknown')
		: 'No WebGL';

	return {
		webglVersion: gl instanceof WebGL2RenderingContext ? 2 : 1,
		supportsHDR: gl ? !!gl.getExtension('EXT_color_buffer_float') : false,
		screenWidth: window.screen.width,
		screenHeight: window.screen.height,
		gpuRenderer: renderer,
		userAgent: navigator.userAgent,
	};
}

// ============================================================================
// CLIENT
// ============================================================================

export class DisplayWsClient {
	private ws: WebSocket | null = null;
	private model: WindowModel;
	private deviceId: string;
	private serverUrl: string;
	private reconnectDelay = 1000;
	private maxReconnectDelay = 30000;
	private statusInterval: ReturnType<typeof setInterval> | null = null;
	private bootTime = Date.now();
	private destroyed = false;

	constructor(model: WindowModel, serverUrl?: string) {
		this.model = model;
		this.deviceId = getDeviceId();
		// Default to same host, port 3001
		this.serverUrl = serverUrl
			|| `ws://${window.location.hostname}:3001/ws?role=display`;
		this.connect();
	}

	private connect(): void {
		if (this.destroyed) return;

		try {
			this.ws = new WebSocket(this.serverUrl);

			this.ws.onopen = () => {
				this.reconnectDelay = 1000; // Reset backoff on successful connect
				this.sendRegister();
				this.startStatusUpdates();
			};

			this.ws.onmessage = (event) => {
				this.handleMessage(event.data);
			};

			this.ws.onclose = () => {
				this.stopStatusUpdates();
				this.scheduleReconnect();
			};

			this.ws.onerror = () => {
				// onclose will fire after onerror
			};
		} catch {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		if (this.destroyed) return;
		setTimeout(() => this.connect(), this.reconnectDelay);
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
	}

	private send(msg: DisplayMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	private sendRegister(): void {
		this.send({
			type: 'register',
			deviceId: this.deviceId,
			hostname: window.location.hostname,
			capabilities: getDeviceCaps(),
		});
	}

	private startStatusUpdates(): void {
		this.stopStatusUpdates();
		this.statusInterval = setInterval(() => {
			this.send({
				type: 'status',
				fps: 60, // TODO: measure actual FPS from RAF loop
				mode: 'flight',
				location: this.model.location,
				uptime: Math.floor((Date.now() - this.bootTime) / 1000),
			});
		}, 5000);
	}

	private stopStatusUpdates(): void {
		if (this.statusInterval) {
			clearInterval(this.statusInterval);
			this.statusInterval = null;
		}
	}

	private handleMessage(raw: string): void {
		let msg: ServerMessage;
		try { msg = JSON.parse(raw); } catch { return; }

		switch (msg.type) {
			case 'ping':
				this.send({ type: 'pong' });
				break;

			case 'set_scene':
				this.model.flyTo(msg.location);
				if (msg.weather) this.model.setWeather(msg.weather);
				break;

			case 'set_mode':
				// For now, only 'flight' mode is implemented
				// Future: screensaver, video URL
				break;

			case 'set_config':
				this.model.applyPatch(msg.patch);
				break;
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.stopStatusUpdates();
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}

/**
 * Create and connect the display WS client.
 * Pass the server URL via ?server= query param, or auto-detect.
 */
export function createWsClient(model: WindowModel): DisplayWsClient {
	const params = new URLSearchParams(window.location.search);
	const serverUrl = params.get('server') || undefined;
	return new DisplayWsClient(model, serverUrl);
}
