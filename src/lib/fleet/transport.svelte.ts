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
