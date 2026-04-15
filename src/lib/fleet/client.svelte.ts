/**
 * WebSocket Client — connects display to fleet management server
 */

import type { ServerMessage, ServerMessageV2, DisplayMessage, DeviceCaps, FleetClientModel } from '$lib/fleet/protocol';
import { isV2 } from '$lib/fleet/protocol';
import { LOCATION_IDS } from '$lib/locations';
import { BaseTransport } from './transport.svelte';
import { resolveFleetUrl } from './url';
import { safeParse, isValidWeather, isValidDisplayMode, isValidQualityMode } from '$lib/validation';

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

	#send(msg: DisplayMessage | { v: 2; type: string; [k: string]: unknown }): void {
		this.#model.telemetry?.recordEvent('fleet_out', { type: msg.type });
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(msg));
		}
	}

	/**
	 * Phase 7 — publish a v2 message from display to server. Used by
	 * WindowModel.#fleetBroadcast so the panorama leader can emit
	 * `director_decision` frames the server fans out to followers.
	 */
	publishV2(msg: { v: 2; type: string; [k: string]: unknown }): void {
		this.#send(msg);
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
		const parsed = safeParse<ServerMessage | ServerMessageV2>(raw);
		if (!parsed) return;

		this.#model.telemetry?.recordEvent('fleet_in', {
			type: (parsed as { type?: string }).type,
			v: (parsed as { v?: number }).v ?? 1,
		});

		// v2 dispatcher — additive. v2 carries an explicit `v: 2` discriminator;
		// v1 messages never do, so the routing is unambiguous.
		if (isV2(parsed)) {
			this.#handleV2(parsed as ServerMessageV2);
			return;
		}

		const msg = parsed as ServerMessage;
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

	/** v2 handler — path patches + parallax role + director decisions. */
	#handleV2(msg: ServerMessageV2): void {
		switch (msg.type) {
			case 'config_patch':
				if (typeof msg.path === 'string') {
					this.#model.applyConfigPatch?.(msg.path, msg.value);
				}
				break;
			case 'config_replace':
				// Apply every leaf of the snapshot as a targeted patch.
				// Keeps one code path (applyConfigPatch) authoritative.
				if (msg.snapshot && typeof msg.snapshot === 'object') {
					for (const [key, value] of Object.entries(msg.snapshot)) {
						this.#model.applyConfigPatch?.(`${msg.layer}.${key}`, value);
					}
				}
				break;
			case 'role_assign':
				// Applied via path patches so all routing converges.
				this.#model.applyConfigPatch?.('camera.parallax.role', msg.role);
				if (msg.headingOffsetDeg !== undefined) {
					this.#model.applyConfigPatch?.('camera.parallax.headingOffsetDeg', msg.headingOffsetDeg);
				}
				if (msg.fovDeg !== undefined) {
					this.#model.applyConfigPatch?.('camera.parallax.fovDeg', msg.fovDeg);
				}
				break;
			case 'director_decision': {
				// Phase 7 — schedule the flyTo at transitionAtMs wall-clock so
				// all three Pis in a panorama flip simultaneously even with
				// ~50-200ms NTP drift between devices. If the message arrived
				// late (transitionAtMs already past), apply immediately and log.
				if (!LOCATION_IDS.has(msg.locationId)) break;
				const weather = isValidWeather(msg.weather) ? msg.weather : undefined;
				const now = Date.now();
				const delay = msg.transitionAtMs - now;
				if (delay < -50) {
					console.warn(
						`[fleet v2] director_decision arrived ${-delay}ms late; applying immediately`,
					);
					this.#model.applyScene(msg.locationId, weather);
				} else {
					setTimeout(
						() => this.#model.applyScene(msg.locationId, weather),
						Math.max(0, delay),
					);
				}
				break;
			}
		}
	}
}

export function createWsClient(model: FleetClientModel): DisplayWsClient {
	const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
	const override = params.get('server') || (import.meta as any).env?.VITE_FLEET_SERVER;
	const { wsUrl } = resolveFleetUrl('display', override);
	return new DisplayWsClient(model, wsUrl);
}
