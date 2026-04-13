/**
 * WebSocket Client — connects display to fleet management server
 */

import type { ServerMessage, DisplayMessage, DeviceCaps, FleetClientModel } from '$lib/fleet/protocol';
import { LOCATION_IDS } from '$lib/locations';
import { BaseTransport } from './transport.svelte';
import { resolveFleetUrl } from './url';
import { safeParse, isValidWeather, isValidDisplayMode, isValidQualityMode } from './validation';

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
	#model: FleetClientModel;
	#deviceId: string;
	#serverUrl: string;
	#statusInterval: ReturnType<typeof setInterval> | null = null;
	#bootTime = Date.now();

	constructor(model: FleetClientModel, serverUrl?: string) {
		super();
		this.#model = model;
		this.#deviceId = getDeviceId();
		this.#serverUrl = serverUrl || resolveFleetUrl('display').wsUrl;
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
		const msg = safeParse<ServerMessage>(raw);
		if (!msg) return;

		switch (msg.type) {
			case 'ping': this.#send({ type: 'pong' }); break;
			case 'set_scene':
				if (LOCATION_IDS.has(msg.location)) {
					this.#model.applyScene(msg.location, isValidWeather(msg.weather) ? msg.weather : undefined);
				}
				break;
			case 'set_mode':
				if (isValidDisplayMode(msg.mode)) this.#model.setDisplayMode(msg.mode, msg.payload);
				break;
			case 'set_config':
				if (msg.patch && typeof msg.patch === 'object') this.#model.applyPatch(msg.patch);
				break;
			case 'set_quality':
				if (isValidQualityMode(msg.mode)) this.#model.setQualityMode(msg.mode);
				break;
		}
	}
}

export function createWsClient(model: FleetClientModel): DisplayWsClient {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const override = params.get('server') || (import.meta as any).env?.VITE_FLEET_SERVER;
	const { wsUrl } = resolveFleetUrl('display', override);
	return new DisplayWsClient(model, wsUrl);
}
