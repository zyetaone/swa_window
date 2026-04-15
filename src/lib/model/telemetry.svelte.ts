/**
 * Telemetry — ring-buffer observability for the display.
 *
 * Captures per-frame duration (p50/p95), lifecycle events, and counters
 * without adding measurable cost to the 60 Hz tick. Reactive surfaces
 * update in coarse batches (on flush/read), so per-frame instrumentation
 * touches only a plain non-reactive buffer.
 *
 * Usage:
 *   telemetry.recordFrame(durationMs);                 // per-tick, cheap
 *   telemetry.recordEvent('config_patch', { path });   // rare, reactive
 *   $effect(() => console.log(telemetry.p50));         // reads batched state
 */

import { untrack } from 'svelte';

export type TelemetryKind =
	| 'config_patch'
	| 'fleet_in'
	| 'fleet_out'
	| 'error'
	| 'info';

export interface TelemetryEvent {
	t: number;
	kind: TelemetryKind;
	payload: unknown;
}

export interface TelemetryCounts {
	configPatches: number;
	fleetIn: number;
	fleetOut: number;
	errors: number;
}

export interface TelemetrySnapshot {
	fps: { recent: number[]; p50: number; p95: number };
	events: TelemetryEvent[];
	counts: TelemetryCounts;
}

const FPS_WINDOW = 120;
const EVENT_CAP = 500;
// Flush frame durations to reactive state every N samples. Keeps per-tick
// cost to a plain push into a non-reactive buffer — ~40 ns vs ~μs for
// a reactive write that would trigger derived recomputation.
const FPS_FLUSH_EVERY = 30;

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
	return sorted[idx];
}

export class Telemetry {
	// Reactive surfaces — read by UI, written in coarse batches.
	// $state.raw keeps array re-assignments cheap (no proxy traversal).
	fpsRecent = $state.raw<number[]>([]);
	events = $state.raw<TelemetryEvent[]>([]);
	counts = $state<TelemetryCounts>({
		configPatches: 0,
		fleetIn: 0,
		fleetOut: 0,
		errors: 0,
	});

	// Non-reactive scratch buffer filled per-frame; flushed in batches.
	#frameBuffer: number[] = [];

	// Cached percentiles — recomputed when fpsRecent changes.
	p50 = $derived.by(() => {
		const arr = this.fpsRecent;
		if (arr.length === 0) return 0;
		return percentile([...arr].sort((a, b) => a - b), 0.5);
	});
	p95 = $derived.by(() => {
		const arr = this.fpsRecent;
		if (arr.length === 0) return 0;
		return percentile([...arr].sort((a, b) => a - b), 0.95);
	});

	/**
	 * Record a frame duration (ms). Hot path — avoids reactive writes
	 * by appending to a plain array and only flushing every N samples.
	 */
	recordFrame(durationMs: number): void {
		if (!Number.isFinite(durationMs) || durationMs < 0) return;
		this.#frameBuffer.push(durationMs);
		if (this.#frameBuffer.length >= FPS_FLUSH_EVERY) {
			this.#flushFrames();
		}
	}

	#flushFrames(): void {
		if (this.#frameBuffer.length === 0) return;
		// Read current value without creating a reactive dep on the flush path.
		const current = untrack(() => this.fpsRecent);
		const next = current.concat(this.#frameBuffer);
		this.#frameBuffer.length = 0;
		this.fpsRecent =
			next.length > FPS_WINDOW ? next.slice(next.length - FPS_WINDOW) : next;
	}

	/**
	 * Record a lifecycle event. Low-frequency — safe to touch reactive state.
	 * Updates the appropriate counter and appends to the ring buffer.
	 */
	recordEvent(kind: TelemetryKind, payload: unknown): void {
		const evt: TelemetryEvent = { t: Date.now(), kind, payload };
		const current = untrack(() => this.events);
		const next = current.concat(evt);
		this.events =
			next.length > EVENT_CAP ? next.slice(next.length - EVENT_CAP) : next;

		switch (kind) {
			case 'config_patch': this.counts.configPatches++; break;
			case 'fleet_in':     this.counts.fleetIn++;       break;
			case 'fleet_out':    this.counts.fleetOut++;      break;
			case 'error':        this.counts.errors++;        break;
		}
	}

	clear(): void {
		this.#frameBuffer.length = 0;
		this.fpsRecent = [];
		this.events = [];
		this.counts = { configPatches: 0, fleetIn: 0, fleetOut: 0, errors: 0 };
	}

	/** Force a flush of pending frame samples (e.g. before snapshot/export). */
	flush(): void {
		this.#flushFrames();
	}

	toJSON(): TelemetrySnapshot {
		this.flush();
		return {
			fps: {
				recent: [...this.fpsRecent],
				p50: this.p50,
				p95: this.p95,
			},
			events: [...this.events],
			counts: { ...this.counts },
		};
	}
}
