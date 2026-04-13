/**
 * WebSocket Client — connects display to fleet management server
 */

import type { ServerMessage, DisplayMessage, DeviceCaps } from '$lib/shared/protocol';
import type { WindowModel } from '$lib/model.svelte';
import { BaseTransport } from './base-transport';

function getDeviceId(): string {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const urlDeviceId = params.get('device');
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
	if (typeof document === 'undefined') return {} as DeviceCaps;
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

export class DisplayWsClient extends BaseTransport {
	#ws: WebSocket | null = $state.raw(null);
	#model: WindowModel;
	#deviceId: string;
	#serverUrl: string;
	#statusInterval: ReturnType<typeof setInterval> | null = null;
	#bootTime = Date.now();

	constructor(model: WindowModel, serverUrl?: string) {
		super();
		this.#model = model;
		this.#deviceId = getDeviceId();
		this.#serverUrl = serverUrl || `ws://${window.location.hostname}:3001/ws?role=display`;
		this.connect();
	}

	connect(): void {
		if (this.isDestroyed) return;
		try {
			this.#ws = new WebSocket(this.#serverUrl);
			this.#ws.onopen = () => {
				this.onConnected();
				this.#sendRegister();
				this.#startStatusUpdates();
			};
			this.#ws.onmessage = (e) => this.#handleMessage(e.data);
			this.#ws.onclose = () => {
				this.#stopStatusUpdates();
				this.onDisconnected();
			};
		} catch {
			this.onDisconnected();
		}
	}

	disconnect(): void {
		this.#stopStatusUpdates();
		if (this.#ws) {
			this.#ws.close();
			this.#ws = null;
		}
	}

	#send(msg: DisplayMessage): void {
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(msg));
		}
	}

	#sendRegister(): void {
		const params = new URLSearchParams(window.location.search);
		const displayName = params.get('display');
		this.#send({
			type: 'register',
			deviceId: this.#deviceId,
			hostname: displayName || this.#deviceId,
			capabilities: getDeviceCaps(),
		});
	}

	#startStatusUpdates(): void {
		this.#stopStatusUpdates();
		this.#statusInterval = setInterval(() => {
			this.#send({
				type: 'status',
				fps: this.#model.measuredFps,
				mode: this.#model.displayMode,
				location: this.#model.location,
				uptime: Math.floor((Date.now() - this.#bootTime) / 1000),
			});
		}, 5000);
	}

	#stopStatusUpdates(): void {
		if (this.#statusInterval) {
			clearInterval(this.#statusInterval);
			this.#statusInterval = null;
		}
	}

	#handleMessage(raw: string): void {
		let msg: ServerMessage;
		try { msg = JSON.parse(raw); } catch { return; }

		switch (msg.type) {
			case 'ping': this.#send({ type: 'pong' }); break;
			case 'set_scene':
				this.#model.flight.flyTo(msg.location);
				if (msg.weather) this.#model.weather = msg.weather;
				break;
			case 'set_mode': this.#model.setDisplayMode(msg.mode, msg.payload); break;
		}
	}
}

export function createWsClient(model: WindowModel): DisplayWsClient {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const url = params.get('server') || (import.meta as any).env?.VITE_FLEET_SERVER;
	return new DisplayWsClient(model, url);
}
