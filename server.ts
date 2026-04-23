/**
 * Custom Bun server — wraps the built SvelteKit handler and kicks off
 * the LAN mDNS peer advertiser.
 *
 * Post-WS: there's no custom transport layer here anymore. Admin talks
 * to each device's REST endpoints (/api/config, /api/status, /api/command)
 * over LAN, and each device's browser subscribes to its own SvelteKit-
 * served /api/events SSE route. All of that runs through `svelteHandler`
 * — this entry just keeps `startLanProxy()` alive so mDNS discovery works.
 *
 * Run: bun run build && bun run server.ts
 */

import { startLanProxy } from './src/lib/fleet/lan-peers.server';

const PORT = parseInt(process.env.PORT || '5173', 10);

// mDNS peer discovery + announce. Silent-fails on platforms without
// multicast (Docker-networked-host, some WSL2 setups) — the app keeps
// running, it just can't find LAN peers. On the Pi, a straight multicast
// socket on the LAN is always available.
if (process.env.AERO_DISABLE_LAN_PROXY !== '1') {
	try {
		startLanProxy();
		console.log('[server] LAN peer discovery started (mDNS _aero-bundle._tcp.local)');
	} catch (e) {
		console.warn('[server] LAN peer discovery failed to start:', (e as Error).message);
	}
}

const mod = await import('./build/handler.js');
const svelteHandler: (req: Request) => Promise<Response> = mod.handler;

Bun.serve({
	port: PORT,
	fetch(req) { return svelteHandler(req); },
});

console.log(`[server] Aero Window running on http://localhost:${PORT}`);
