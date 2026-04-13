/**
 * Fleet Hub — device registry, WebSocket routing, admin broadcast.
 *
 * Pure logic module. Does NOT call Bun.serve(). The custom server entry
 * (server.ts) wires this into the Bun WebSocket handlers.
 *
 * Usage:
 *   import { fleet } from '$lib/fleet/hub';
 *   // In Bun.serve websocket handlers:
 *   fleet.onOpen(ws);
 *   fleet.onMessage(ws, raw);
 *   fleet.onClose(ws);
 *   // REST:
 *   fleet.getDevices();
 *   fleet.getHealth();
 *   fleet.pushScene(deviceId, location, weather);
 */

import type {
	ServerMessage,
	DisplayMessage,
	DeviceInfo,
	DisplayConfig,
} from '$lib/fleet/protocol';
import type { LocationId, WeatherType, DisplayMode } from '$lib/types';

interface WsLike {
	send(data: string): void;
	data?: { role: 'display' | 'admin' };
}

const devices = new Map<string, DeviceInfo>();
const displaySockets = new Map<string, WsLike>();
const adminSockets = new Set<WsLike>();
const sseClients = new Map<string, ReadableStreamDirectController>();
let sseEventSeq = 0;

const HEARTBEAT_TIMEOUT = 30_000;

function broadcastToAdmins(data: unknown): void {
	const msg = JSON.stringify(data);
	const eventType = (data as { type?: string })?.type ?? 'message';

	for (const ws of adminSockets) {
		try { ws.send(msg); } catch { /* disconnected */ }
	}

	const sseId = `evt-${++sseEventSeq}`;
	const ssePayload = `id: ${sseId}\nevent: ${eventType}\ndata: ${msg}\n\n`;
	for (const [clientId, controller] of sseClients) {
		try { controller.write(ssePayload); }
		catch { sseClients.delete(clientId); }
	}
}

function sendToDevice(deviceId: string, message: ServerMessage): boolean {
	const ws = displaySockets.get(deviceId);
	if (!ws) return false;
	try { ws.send(JSON.stringify(message)); return true; }
	catch { return false; }
}

// Heartbeat: mark offline after 30s silence
setInterval(() => {
	const now = Date.now();
	for (const device of devices.values()) {
		if (now - device.lastSeen > HEARTBEAT_TIMEOUT) device.online = false;
	}
}, 10_000);

// Ping displays every 15s
setInterval(() => {
	const msg = JSON.stringify({ type: 'ping' } as ServerMessage);
	for (const ws of displaySockets.values()) {
		try { ws.send(msg); } catch { /* disconnected */ }
	}
}, 15_000);

export const fleet = {
	// WebSocket lifecycle
	onOpen(ws: WsLike): void {
		if (ws.data?.role === 'admin') adminSockets.add(ws);
	},

	onMessage(ws: WsLike, raw: string): void {
		if (ws.data?.role === 'display') {
			let msg: DisplayMessage;
			try { msg = JSON.parse(raw); } catch { return; }

			if (msg.type === 'register') {
				const device: DeviceInfo = {
					deviceId: msg.deviceId,
					hostname: msg.hostname,
					capabilities: msg.capabilities,
					currentMode: 'flight',
					currentLocation: 'dubai' as LocationId,
					fps: 0, uptime: 0,
					lastSeen: Date.now(),
					online: true,
				};
				devices.set(msg.deviceId, device);
				displaySockets.set(msg.deviceId, ws);
				broadcastToAdmins({ type: 'device_registered', device });
			} else if (msg.type === 'status') {
				for (const [id, sock] of displaySockets) {
					if (sock === ws) {
						const device = devices.get(id);
						if (device) {
							Object.assign(device, {
								fps: msg.fps, currentMode: msg.mode,
								currentLocation: msg.location as LocationId,
								uptime: msg.uptime, lastSeen: Date.now(), online: true,
							});
							broadcastToAdmins({ type: 'device_status', deviceId: id, fps: msg.fps, mode: msg.mode, location: msg.location, uptime: msg.uptime });
						}
						break;
					}
				}
			} else if (msg.type === 'pong') {
				for (const [id, sock] of displaySockets) {
					if (sock === ws) {
						const device = devices.get(id);
						if (device) { device.lastSeen = Date.now(); device.online = true; }
						break;
					}
				}
			}
		} else if (ws.data?.role === 'admin') {
			try {
				const cmd = JSON.parse(raw) as { targetDeviceId: string; message: ServerMessage };
				if (cmd.targetDeviceId && cmd.message) sendToDevice(cmd.targetDeviceId, cmd.message);
			} catch { /* invalid */ }
		}
	},

	onClose(ws: WsLike): void {
		if (ws.data?.role === 'admin') {
			adminSockets.delete(ws);
		} else {
			for (const [id, sock] of displaySockets) {
				if (sock === ws) {
					displaySockets.delete(id);
					const device = devices.get(id);
					if (device) device.online = false;
					broadcastToAdmins({ type: 'device_offline', deviceId: id });
					break;
				}
			}
		}
	},

	// REST helpers
	getDevices(): DeviceInfo[] { return Array.from(devices.values()); },

	getHealth() {
		const list = this.getDevices();
		const online = list.filter(d => d.online);
		const offline = list.filter(d => !d.online);
		const avgFps = online.length > 0
			? online.reduce((sum, d) => sum + d.fps, 0) / online.length : 0;
		return {
			status: 'ok',
			serverUptime: Math.floor(process.uptime()),
			fleet: { total: list.length, online: online.length, offline: offline.length, avgFps: Math.round(avgFps * 10) / 10, lowFpsCount: online.filter(d => d.fps > 0 && d.fps < 30).length },
			alerts: [
				...offline.map(d => ({ level: 'error' as const, device: d.deviceId, message: `${d.hostname || d.deviceId} is offline` })),
				...online.filter(d => d.fps > 0 && d.fps < 30).map(d => ({ level: 'warning' as const, device: d.deviceId, message: `${d.hostname || d.deviceId} low FPS: ${d.fps.toFixed(0)}` })),
			],
		};
	},

	pushScene(deviceId: string, location: LocationId, weather?: WeatherType): boolean {
		return sendToDevice(deviceId, { type: 'set_scene', location, weather });
	},

	pushMode(deviceId: string, mode: DisplayMode, payload?: string): boolean {
		return sendToDevice(deviceId, { type: 'set_mode', mode, payload });
	},

	pushConfig(deviceId: string, patch: DisplayConfig): boolean {
		return sendToDevice(deviceId, { type: 'set_config', patch });
	},

	broadcastScene(location: LocationId, weather?: WeatherType): number {
		const message: ServerMessage = { type: 'set_scene', location, weather };
		let sent = 0;
		for (const id of displaySockets.keys()) {
			if (sendToDevice(id, message)) sent++;
		}
		return sent;
	},

	// SSE
	addSseClient(clientId: string, controller: ReadableStreamDirectController): void {
		sseClients.set(clientId, controller);
		for (const device of devices.values()) {
			const payload = JSON.stringify({ type: 'device_registered', device });
			controller.write(`id: init-${device.deviceId}\nevent: device_registered\ndata: ${payload}\n\n`);
		}
		controller.write(`event: connected\ndata: ${JSON.stringify({ clientId, transport: 'sse' })}\n\n`);
	},

	removeSseClient(clientId: string): void {
		sseClients.delete(clientId);
	},
};
