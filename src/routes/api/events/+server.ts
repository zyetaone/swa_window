/**
 * GET /api/events — SSE stream for the same-origin browser.
 *
 * The Pi's browser opens an EventSource to this endpoint on startup. When
 * admin PATCHes /api/config or POSTs /api/command on this device, the
 * in-process sse-bus publishes an event that this stream forwards as an
 * SSE frame. Replaces the server → browser leg of the old WS broker.
 *
 * Same-origin only — no CORS headers. Admin doesn't subscribe here;
 * admin polls /api/status on each device instead.
 */

import type { RequestHandler } from './$types';
import { subscribe, replayTo, type SseEvent } from '$lib/server/fleet/sse-bus';

export const GET: RequestHandler = () => {
	let unsubscribe: (() => void) | null = null;
	let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const write = (frame: string) => {
				try { controller.enqueue(encoder.encode(frame)); }
				catch { /* closed — ignore */ }
			};

			// Open the stream with a connected event so EventSource.onopen fires.
			write(`event: connected\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);

			const writeEvent = (ev: SseEvent) => {
				write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
			};

			// Replay buffered events from before the browser connected.
			// Covers the page-reload gap where REST endpoints published
			// config_patch / command events with no subscriber attached.
			replayTo(writeEvent);

			unsubscribe = subscribe(writeEvent);

			// Comment pings keep idle streams alive through proxies / WAF.
			keepAliveTimer = setInterval(() => write(`: keep-alive\n\n`), 20_000);
		},
		cancel() {
			unsubscribe?.();
			unsubscribe = null;
			if (keepAliveTimer) clearInterval(keepAliveTimer);
			keepAliveTimer = null;
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no',
		},
	});
};
