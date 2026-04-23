/**
 * In-process pub/sub bus for server → same-origin browser events.
 *
 * Used by REST endpoints (PATCH /api/config, POST /api/command) to push
 * events to this device's browser through an SSE stream (GET /api/events).
 * Replaces the WebSocket broker for the server ↔ local-browser leg —
 * admin ↔ device traffic is plain REST, no bus involved.
 *
 * Subscribers are per-SSE-connection callbacks. On disconnect the caller
 * invokes the returned unsubscribe. No buffering, no ordering guarantees
 * beyond what publish() + the event loop provide — events are lost if no
 * subscriber is attached when publish() fires (browser CAN miss an event
 * during a page reload; the startup flow re-reads /api/status to reconcile).
 */

export interface SseEvent {
	/** Event name — becomes the SSE `event:` field. */
	type: string;
	/** Payload object, JSON-serialised for the SSE `data:` field. */
	data: unknown;
}

const subscribers = new Set<(event: SseEvent) => void>();

/** Fan out an event to every current subscriber. */
export function publish(event: SseEvent): void {
	for (const fn of subscribers) {
		try { fn(event); } catch { /* subscriber exploded — skip, don't crash others */ }
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
