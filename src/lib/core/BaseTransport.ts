/**
 * BaseTransport - Shared logic for fleet connections (WS/SSE).
 *
 * Handles exponential backoff, connection state, and basic lifecycle.
 */

export type TransportState = 'connecting' | 'connected' | 'disconnected';

export interface TransportOptions {
	maxReconnectDelay?: number;
	initialReconnectDelay?: number;
}

export abstract class BaseTransport {
	protected state = $state<TransportState>('disconnected');
	protected reconnectDelay: number;
	protected readonly maxReconnectDelay: number;
	protected readonly initialReconnectDelay: number;
	protected destroyed = false;

	constructor(options: TransportOptions = {}) {
		this.initialReconnectDelay = options.initialReconnectDelay ?? 1000;
		this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
		this.reconnectDelay = this.initialReconnectDelay;
	}

	abstract connect(): void;
	abstract disconnect(): void;

	protected onConnected(): void {
		this.state = 'connected';
		this.reconnectDelay = this.initialReconnectDelay;
	}

	protected onDisconnected(): void {
		this.state = 'disconnected';
		this.scheduleReconnect();
	}

	protected scheduleReconnect(): void {
		if (this.destroyed) return;
		setTimeout(() => this.connect(), this.reconnectDelay);
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
	}

	destroy(): void {
		this.destroyed = true;
		this.disconnect();
	}

	get connectionState() { return this.state; }
}
