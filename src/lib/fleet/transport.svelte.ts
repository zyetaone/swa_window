/**
 * BaseTransport - Shared logic for fleet connections (WS/SSE).
 */

export type TransportState = 'connecting' | 'connected' | 'disconnected';

export interface TransportOptions {
	maxReconnectDelay?: number;
	initialReconnectDelay?: number;
}

export abstract class BaseTransport {
	#state = $state<TransportState>('disconnected');
	#reconnectDelay: number;
	#maxReconnectDelay: number;
	#initialReconnectDelay: number;
	#destroyed = false;

	constructor(options: TransportOptions = {}) {
		this.#initialReconnectDelay = options.initialReconnectDelay ?? 1000;
		this.#maxReconnectDelay = options.maxReconnectDelay ?? 30000;
		this.#reconnectDelay = this.#initialReconnectDelay;
	}

	abstract connect(): void;
	abstract disconnect(): void;

	protected onConnected(): void {
		this.#state = 'connected';
		this.#reconnectDelay = this.#initialReconnectDelay;
	}

	protected onDisconnected(autoReconnect = true): void {
		this.#state = 'disconnected';
		if (autoReconnect) this.#scheduleReconnect();
	}

	#scheduleReconnect(): void {
		if (this.#destroyed) return;
		setTimeout(() => this.connect(), this.#reconnectDelay);
		this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, this.#maxReconnectDelay);
	}

	destroy(): void {
		this.#destroyed = true;
		this.disconnect();
	}

	get connectionState() { return this.#state; }
	get isDestroyed() { return this.#destroyed; }
}

export interface FleetTransportOptions {
	url: string;
	onOpen?: () => void;
	onMessage: (data: string) => void;
	onClose?: (autoReconnect: boolean) => void;
	onError?: (e: Event) => void;
	autoReconnect?: boolean;
}

export function createFleetTransport(opts: FleetTransportOptions): { send: (data: string) => void; close: () => void } {
	let ws: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;
	let reconnectDelay = 1000;
	const MAX_DELAY = 30000;

	function connect() {
		if (destroyed) return;
		try {
			ws = new WebSocket(opts.url);
			ws.onopen = () => { reconnectDelay = 1000; opts.onOpen?.(); };
			ws.onmessage = (ev) => opts.onMessage(ev.data);
			ws.onclose = () => {
				ws = null;
				if (opts.autoReconnect && !destroyed) {
					reconnectTimer = setTimeout(() => {
						reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
						connect();
					}, reconnectDelay);
				}
				opts.onClose?.(!!opts.autoReconnect);
			};
			ws.onerror = (e) => opts.onError?.(e);
		} catch {
			opts.onClose?.(!!opts.autoReconnect);
		}
	}

	connect();

	return {
		send(data: string) { ws?.send(data); },
		close() {
			destroyed = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			ws?.close();
		},
	};
}
