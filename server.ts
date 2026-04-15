/**
 * Custom Bun server — SvelteKit app + WebSocket fleet hub on one port.
 *
 * Replaces the separate server/ package. Run with: bun run server.ts
 * Or in production: bun run build && bun run server.ts
 *
 * WebSocket: ws://host:PORT/ws?role=display|admin
 * SvelteKit: everything else (handled by adapter-node)
 */

import { fleet } from './src/lib/fleet/hub';

const PORT = parseInt(process.env.PORT || '5173', 10);

// In production, import the built SvelteKit handler
let svelteHandler: ((req: Request) => Promise<Response>) | null = null;
try {
	const mod = await import('./build/handler.js');
	svelteHandler = mod.handler;
	console.log('[server] SvelteKit handler loaded from build/');
} catch {
	console.log('[server] No build/ found — WebSocket-only mode (run vite dev separately)');
}

interface WsData { role: 'display' | 'admin' }

Bun.serve<WsData>({
	port: PORT,
	async fetch(req, server) {
		const url = new URL(req.url);

		// WebSocket upgrade
		if (url.pathname === '/ws') {
			const role = url.searchParams.get('role') === 'admin' ? 'admin' : 'display';
			const upgraded = server.upgrade(req, { data: { role } as WsData });
			if (upgraded) return undefined as unknown as Response;
			return new Response('WebSocket upgrade failed', { status: 400 });
		}

		// SSE endpoint for remote admin
		if (url.pathname === '/api/events') {
			const clientId = crypto.randomUUID();
			const stream = new ReadableStream({
				type: 'direct',
				pull(controller: ReadableStreamDirectController) {
					fleet.addSseClient(clientId, controller);
					const keepAlive = setInterval(() => {
						try { controller.write(': keepalive\n\n'); }
						catch { clearInterval(keepAlive); }
					}, 30_000);
					return new Promise<void>(() => {});
				},
				cancel() { fleet.removeSseClient(clientId); },
			} as unknown as UnderlyingSource);

			return new Response(stream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
					'Access-Control-Allow-Origin': '*',
				},
			});
		}

		// SvelteKit handles everything else
		if (svelteHandler) {
			return svelteHandler(req);
		}

		return new Response('Not found (no build)', { status: 404 });
	},
	websocket: {
		open(ws) { fleet.onOpen(ws); },
		message(ws, message) {
			const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
			fleet.onMessage(ws, raw);
		},
		close(ws) { fleet.onClose(ws); },
	},
});

console.log(`[server] Aero Window running on http://localhost:${PORT}`);
console.log(`[server] WebSocket: ws://localhost:${PORT}/ws`);
