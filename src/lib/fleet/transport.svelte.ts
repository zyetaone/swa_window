/**
 * Fleet transport — merged reactive state-tracker + WebSocket lifecycle.
 */

export type TransportState = 'connecting' | 'connected' | 'disconnected';

export interface FleetTransport {
	/** Reactive $state — read freely in $derived / $effect. */
	readonly state: TransportState;
	/** Register a state-change listener. Returns an unsubscribe function. */
	subscribe(fn: (s: TransportState) => void): () => void;
	/** Send a raw string over the wire. No-op if disconnected. */
	send(data: string): void;
	/** Close the connection; stop auto-reconnect. Idempotent. */
	close(): void;
	/** True after close() has been called. */
	readonly isDestroyed: boolean;
}

export interface FleetTransportOptions {
	url: string;
	onMessage: (data: string) => void;
	autoReconnect?: boolean;
	onError?: (e: Event) => void;
}

export function createFleetTransport(opts: FleetTransportOptions): FleetTransport {
	let _state = $state<TransportState>('connecting');
	const listeners = new Set<(s: TransportState) => void>();

	let ws: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;
	let reconnectDelay = 1000;
	const INITIAL_DELAY = 1000;
	const MAX_DELAY = 30000;

	function setState(s: TransportState) {
		_state = s;
		for (const fn of listeners) fn(s);
	}

	function connect() {
		if (destroyed) return;
		setState('connecting');
		try {
			ws = new WebSocket(opts.url);
			ws.onopen = () => {
				reconnectDelay = INITIAL_DELAY;
				setState('connected');
			};
			ws.onmessage = (ev) => opts.onMessage(ev.data);
			ws.onclose = () => {
				ws = null;
				setState('disconnected');
				if (opts.autoReconnect && !destroyed) {
					reconnectTimer = setTimeout(() => {
						reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
						connect();
					}, reconnectDelay);
				}
			};
			ws.onerror = (e) => {
				opts.onError?.(e);
			};
		} catch {
			setState('disconnected');
		}
	}

	connect();

	return {
		get state() { return _state; },
		subscribe(fn: (s: TransportState) => void) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		send(data: string) { ws?.send(data); },
		close() {
			if (destroyed) return;
			destroyed = true;
			if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
			ws?.close();
			setState('disconnected');
		},
		get isDestroyed() { return destroyed; },
	};
}
