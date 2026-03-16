/**
 * WebSocket Hub + REST API
 *
 * Manages device connections, routes admin commands to displays,
 * and serves REST endpoints for the admin SPA.
 */

import type {
	ServerMessage,
	DisplayMessage,
	DeviceInfo,
	DisplayMode,
	LocationId,
	WeatherType,
} from '@zyeta/shared';

// ============================================================================
// DEVICE REGISTRY
// ============================================================================

const devices = new Map<string, DeviceInfo>();
const displaySockets = new Map<string, WebSocket>();
const adminSockets = new Set<WebSocket>();

const HEARTBEAT_TIMEOUT = 30_000; // 30s no pong → mark offline

function broadcastToAdmins(data: unknown): void {
	const msg = JSON.stringify(data);
	for (const ws of adminSockets) {
		try { ws.send(msg); } catch { /* admin disconnected */ }
	}
}

function getDeviceList(): DeviceInfo[] {
	return Array.from(devices.values());
}

// Heartbeat: mark devices offline if no pong received
setInterval(() => {
	const now = Date.now();
	for (const [id, device] of devices) {
		if (now - device.lastSeen > HEARTBEAT_TIMEOUT) {
			device.online = false;
		}
	}
}, 10_000);

// Ping all displays every 15s
setInterval(() => {
	const ping: ServerMessage = { type: 'ping' };
	const msg = JSON.stringify(ping);
	for (const ws of displaySockets.values()) {
		try { ws.send(msg); } catch { /* display disconnected */ }
	}
}, 15_000);

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

function handleDisplayMessage(ws: WebSocket, raw: string): void {
	let msg: DisplayMessage;
	try { msg = JSON.parse(raw); } catch { return; }

	switch (msg.type) {
		case 'register': {
			const device: DeviceInfo = {
				deviceId: msg.deviceId,
				hostname: msg.hostname,
				capabilities: msg.capabilities,
				currentMode: 'flight',
				currentLocation: 'dubai' as LocationId,
				fps: 0,
				uptime: 0,
				lastSeen: Date.now(),
				online: true,
			};
			devices.set(msg.deviceId, device);
			displaySockets.set(msg.deviceId, ws);
			broadcastToAdmins({ type: 'device_registered', device });
			break;
		}
		case 'status': {
			// Find device by socket
			for (const [id, sock] of displaySockets) {
				if (sock === ws) {
					const device = devices.get(id);
					if (device) {
						device.fps = msg.fps;
						device.currentMode = msg.mode;
						device.currentLocation = msg.location as LocationId;
						device.uptime = msg.uptime;
						device.lastSeen = Date.now();
						device.online = true;
						broadcastToAdmins({ type: 'device_status', deviceId: id, ...msg });
					}
					break;
				}
			}
			break;
		}
		case 'pong': {
			for (const [id, sock] of displaySockets) {
				if (sock === ws) {
					const device = devices.get(id);
					if (device) {
						device.lastSeen = Date.now();
						device.online = true;
					}
					break;
				}
			}
			break;
		}
	}
}

function sendToDevice(deviceId: string, message: ServerMessage): boolean {
	const ws = displaySockets.get(deviceId);
	if (!ws) return false;
	try {
		ws.send(JSON.stringify(message));
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// HTTP + WEBSOCKET SERVER
// ============================================================================

export function serve(port: number): void {
	Bun.serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);

			// WebSocket upgrade
			if (url.pathname === '/ws') {
				const role = url.searchParams.get('role') || 'display';
				const upgraded = this.upgrade(req, { data: { role } });
				if (upgraded) return undefined as unknown as Response;
				return new Response('WebSocket upgrade failed', { status: 400 });
			}

			// CORS headers for admin SPA
			const corsHeaders = {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
			};

			if (req.method === 'OPTIONS') {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			// REST API
			if (url.pathname === '/api/health') {
				const deviceList = getDeviceList();
				const online = deviceList.filter(d => d.online);
				const offline = deviceList.filter(d => !d.online);
				const avgFps = online.length > 0
					? online.reduce((sum, d) => sum + d.fps, 0) / online.length
					: 0;
				const lowFpsDevices = online.filter(d => d.fps > 0 && d.fps < 30);

				return Response.json({
					status: 'ok',
					serverUptime: Math.floor(process.uptime()),
					fleet: {
						total: deviceList.length,
						online: online.length,
						offline: offline.length,
						avgFps: Math.round(avgFps * 10) / 10,
						lowFpsCount: lowFpsDevices.length,
					},
					alerts: [
						...offline.map(d => ({
							level: 'error' as const,
							device: d.deviceId,
							message: `${d.hostname || d.deviceId} is offline`,
						})),
						...lowFpsDevices.map(d => ({
							level: 'warning' as const,
							device: d.deviceId,
							message: `${d.hostname || d.deviceId} low FPS: ${d.fps.toFixed(0)}`,
						})),
					],
				}, { headers: corsHeaders });
			}

			if (url.pathname === '/api/devices' && req.method === 'GET') {
				return Response.json(getDeviceList(), { headers: corsHeaders });
			}

			// POST /api/devices/:id/scene
			const sceneMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/scene$/);
			if (sceneMatch && req.method === 'POST') {
				const deviceId = sceneMatch[1];
				const body = await req.json() as { location?: LocationId; weather?: WeatherType };
				const message: ServerMessage = {
					type: 'set_scene',
					location: body.location || 'dubai' as LocationId,
					weather: body.weather,
				};
				const sent = sendToDevice(deviceId, message);
				return Response.json({ success: sent }, { headers: corsHeaders });
			}

			// POST /api/devices/:id/mode
			const modeMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/mode$/);
			if (modeMatch && req.method === 'POST') {
				const deviceId = modeMatch[1];
				const body = await req.json() as { mode: DisplayMode; payload?: string };
				const message: ServerMessage = {
					type: 'set_mode',
					mode: body.mode,
					payload: body.payload,
				};
				const sent = sendToDevice(deviceId, message);
				return Response.json({ success: sent }, { headers: corsHeaders });
			}

			// POST /api/devices/:id/config
			const configMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/config$/);
			if (configMatch && req.method === 'POST') {
				const deviceId = configMatch[1];
				const body = await req.json();
				const message: ServerMessage = { type: 'set_config', patch: body };
				const sent = sendToDevice(deviceId, message);
				return Response.json({ success: sent }, { headers: corsHeaders });
			}

			// POST /api/broadcast/scene — push to ALL displays
			if (url.pathname === '/api/broadcast/scene' && req.method === 'POST') {
				const body = await req.json() as { location?: LocationId; weather?: WeatherType };
				const message: ServerMessage = {
					type: 'set_scene',
					location: body.location || 'dubai' as LocationId,
					weather: body.weather,
				};
				let sent = 0;
				for (const id of displaySockets.keys()) {
					if (sendToDevice(id, message)) sent++;
				}
				return Response.json({ success: true, sentTo: sent }, { headers: corsHeaders });
			}

			return new Response('Not found', { status: 404 });
		},
		websocket: {
			open(ws) {
				const data = ws.data as { role: string };
				if (data.role === 'admin') {
					adminSockets.add(ws as unknown as WebSocket);
				}
			},
			message(ws, message) {
				const data = ws.data as { role: string };
				const raw = typeof message === 'string' ? message : new TextDecoder().decode(message as ArrayBuffer);

				if (data.role === 'display') {
					handleDisplayMessage(ws as unknown as WebSocket, raw);
				} else if (data.role === 'admin') {
					// Admin can send commands that get routed to specific devices
					try {
						const cmd = JSON.parse(raw) as { targetDeviceId: string; message: ServerMessage };
						if (cmd.targetDeviceId && cmd.message) {
							sendToDevice(cmd.targetDeviceId, cmd.message);
						}
					} catch { /* invalid admin command */ }
				}
			},
			close(ws) {
				const data = ws.data as { role: string };
				if (data.role === 'admin') {
					adminSockets.delete(ws as unknown as WebSocket);
				} else {
					// Remove display from registry
					for (const [id, sock] of displaySockets) {
						if (sock === (ws as unknown as WebSocket)) {
							displaySockets.delete(id);
							const device = devices.get(id);
							if (device) device.online = false;
							broadcastToAdmins({ type: 'device_offline', deviceId: id });
							break;
						}
					}
				}
			},
		},
	});
}
