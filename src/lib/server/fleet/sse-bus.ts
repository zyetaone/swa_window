/**
 * In-process pub/sub bus for server → same-origin browser events.
 *
 * Used by REST endpoints (PATCH /api/config, POST /api/command) to push
 * events to this device's browser through an SSE stream (GET /api/events).
 * Replaces the WebSocket broker for the server ↔ local-browser leg —
 * admin ↔ device traffic is plain REST, no bus involved.
 *
 * Subscribers are per-SSE-connection callbacks. On disconnect the caller
 * invokes the returned unsubscribe.
 *
 * Ring buffer: the last N `config_patch` and `command` events are retained
 * (up to BUFFER_SIZE events, ~64 KB max). When a new subscriber connects,
 * buffered events are replayed so the browser recovers patches/commands
 * sent during a page reload without relying solely on the startup
 * /api/status reconciliation flow.
 */

/** Event types eligible for buffering + replay. */
const REPLAYABLE_TYPES = new Set(['config_patch', 'command']);

/** Max buffered events — ring buffer, oldest evicted on overflow. */
const BUFFER_SIZE = 32;

export interface SseEvent {
	/** Event name — becomes the SSE `event:` field. */
	type: string;
	/** Payload object, JSON-serialised for the SSE `data:` field. */
	data: unknown;
}

const subscribers = new Set<(event: SseEvent) => void>();

/** Ring buffer of recent replayable events. */
const buffer: SseEvent[] = [];

/** Fan out an event to every current subscriber.
 *
 * Drops events whose `type` contains CR/LF — those bytes would let an event
 * synthesise additional SSE frames on the wire (defence-in-depth: every
 * current call-site uses hardcoded literal types, but a future call-site
 * passing user input must not be able to inject events).
 *
 * Replayable events (config_patch, command) are pushed into the ring buffer
 * so they survive a browser-reload subscriber gap.
 */
export function publish(event: SseEvent): void {
	if (/[\r\n]/.test(event.type)) return;

	if (REPLAYABLE_TYPES.has(event.type)) {
		buffer.push(event);
		if (buffer.length > BUFFER_SIZE) buffer.shift();
	}

	for (const fn of subscribers) {
		try { fn(event); } catch { /* subscriber exploded — skip, don't crash others */ }
	}
}

/**
 * Replay buffered events to a callback. Called once per new subscriber
 * before live events start flowing. Preserves insertion order.
 */
export function replayTo(fn: (event: SseEvent) => void): void {
	for (const event of buffer) {
		try { fn(event); } catch { /* subscriber exploded — skip */ }
	}
}

/** Register a callback. Returns an unsubscribe function. */
export function subscribe(fn: (event: SseEvent) => void): () => void {
	subscribers.add(fn);
	return () => { subscribers.delete(fn); };
}

/** Debug / tests: current subscriber count. */
export function subscriberCount(): number {
	return subscribers.size;
}

/** Debug / tests: current buffer length. */
export function bufferSize(): number {
	return buffer.length;
}

/** Debug / tests: clear the buffer (for test isolation). */
export function clearBuffer(): void {
	buffer.length = 0;
}
